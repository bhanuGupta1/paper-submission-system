'use strict';

/**
 * AI Reviewer Assistant.
 *
 * Given a paper, return a structured first-pass review draft. The
 * reviewer can then edit and submit it. The boundary is important:
 * the AI never *submits* - it only drafts. Whether the human reviewer
 * accepted AI assistance is logged on the review record.
 */

const llm = require('./llm');
const { run } = require('../db/connection');

async function draftReviewFor(paper, userId) {
  const be = llm.forFeature('review');
  const draft = await be.draftReview(paper);
  await audit(userId, 'draft_review', be);
  return draft;
}

async function audit(userId, action, be) {
  await run(
    'INSERT INTO ai_audit (user_id, action, provider) VALUES (?,?,?)',
    [userId || null, action, (be && be.providerName) || llm.providerName || 'heuristic']
  );
}

module.exports = { draftReviewFor };
