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
  const draft = await llm.draftReview(paper);
  await audit(userId, 'draft_review');
  return draft;
}

async function audit(userId, action) {
  await run(
    'INSERT INTO ai_audit (user_id, action, provider) VALUES (?,?,?)',
    [userId || null, action, llm.providerName || 'heuristic']
  );
}

module.exports = { draftReviewFor };
