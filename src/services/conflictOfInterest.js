'use strict';

/**
 * Conflict-of-interest detection.
 *
 * For a given paper and a candidate reviewer, surface signals that
 * suggest the reviewer should NOT be assigned:
 *
 *   1. Reviewer is the paper's submitting author.
 *   2. Reviewer and the submitting author share an affiliation.
 *   3. Reviewer name appears in the paper's free-text authors field
 *      (catches co-authors who are not the submitter).
 *   4. Reviewer has a recorded co-authorship history with the submitter
 *      in the `coauthorships` table within the last 5 years.
 *
 * Returns { hasConflict, signals[], severity } so the UI can render
 * a transparent badge.
 */

const { get, all } = require('../db/connection');

function nameTokens(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

async function check(paper, reviewer) {
  const signals = [];
  let severity = 0;

  if (!paper || !reviewer) return { hasConflict: false, signals, severity };

  // 1. Submitting-author identity.
  if (paper.author_id === reviewer.id) {
    signals.push({ kind: 'self', label: 'Reviewer is the submitting author', weight: 100 });
    severity += 100;
  }

  // 2. Shared affiliation.
  const author = await get('SELECT affiliation FROM users WHERE id = ?', [paper.author_id]);
  if (author && reviewer.affiliation && author.affiliation && author.affiliation.trim() &&
      author.affiliation.trim().toLowerCase() === reviewer.affiliation.trim().toLowerCase()) {
    signals.push({ kind: 'affiliation', label: `Shared affiliation: ${author.affiliation}`, weight: 60 });
    severity += 60;
  }

  // 3. Reviewer username appears in free-text authors.
  const authorsField = (paper.authors || '').toLowerCase();
  const reviewerTokens = nameTokens(reviewer.username + ' ' + (reviewer.email || '').split('@')[0]);
  for (const t of reviewerTokens) {
    if (authorsField.includes(t)) {
      signals.push({ kind: 'name', label: `Reviewer name token "${t}" appears in paper authors`, weight: 40 });
      severity += 40;
      break;
    }
  }

  // 4. Recorded co-authorship in last 5 years.
  const [low, high] = paper.author_id < reviewer.id
    ? [paper.author_id, reviewer.id]
    : [reviewer.id, paper.author_id];
  const cutoff = new Date().getFullYear() - 5;
  const coauth = await get(
    'SELECT year FROM coauthorships WHERE user_a_id = ? AND user_b_id = ? AND (year IS NULL OR year >= ?)',
    [low, high, cutoff]
  );
  if (coauth) {
    signals.push({ kind: 'coauthorship', label: `Recent co-authorship (${coauth.year || 'undated'})`, weight: 80 });
    severity += 80;
  }

  return { hasConflict: severity >= 40, signals, severity };
}

/**
 * Bulk check: filter a list of candidate reviewers for COI against a paper.
 * Returns each reviewer annotated with .conflict = { hasConflict, signals, severity }.
 */
async function annotate(paper, reviewers) {
  const out = [];
  for (const r of reviewers) {
    const conflict = await check(paper, r);
    out.push({ ...r, conflict });
  }
  return out;
}

module.exports = { check, annotate };
