'use strict';

/**
 * Smart reviewer matching.
 *
 * Replaces v1's `Math.random()` reviewer assignment with TF-IDF cosine
 * similarity between paper text and reviewer expertise tags, and
 * filters out reviewers with a conflict of interest.
 *
 *   excludeUserId  - skip this user (typically the paper's submitting author)
 *   topK           - keep this many candidates
 *   filterCoi      - if true (default), drop reviewers flagged by COI checker
 */

const User = require('../models/User');
const Review = require('../models/Review');
const coi = require('./conflictOfInterest');
const { buildModel, embed, cosine } = require('./embeddings');

async function rankReviewers(paper, { excludeUserId = null, topK = 5, filterCoi = true } = {}) {
  const all = (await User.listReviewers()).filter((r) => r.id !== excludeUserId);
  const annotated = await coi.annotate(paper, all);

  const usable = annotated.filter((r) => r.expertise && r.expertise.trim() && (!filterCoi || !r.conflict.hasConflict));
  let pool = usable;

  if (pool.length === 0) {
    // Falls back to non-COI reviewers even without expertise.
    pool = annotated.filter((r) => !filterCoi || !r.conflict.hasConflict).slice(0, topK)
      .map((r) => ({ ...r, score: 0 }));
    return pool;
  }

  const corpus = pool.map((r) => r.expertise || '');
  const { vectors, idf } = buildModel(corpus);
  const paperVec = embed(`${paper.title} ${paper.abstract} ${paper.keywords || ''} ${paper.tags || ''}`, idf);
  const ranked = pool
    .map((r, i) => ({ ...r, score: Number(cosine(paperVec, vectors[i]).toFixed(4)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
  return ranked;
}

/**
 * Auto-assign reviewers, skipping conflicted candidates and avoiding double-assignment.
 */
async function autoAssign(paper, { count = 2, excludeUserId = null } = {}) {
  const ranked = await rankReviewers(paper, { excludeUserId, topK: Math.max(count + 2, 5) });
  const picked = [];
  for (const candidate of ranked) {
    if (picked.length >= count) break;
    const existing = await Review.findByPaperReviewer(paper.id, candidate.id);
    if (existing) continue;
    await Review.assign(paper.id, candidate.id);
    picked.push(candidate);
  }
  return picked;
}

module.exports = { rankReviewers, autoAssign };
