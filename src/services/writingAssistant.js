'use strict';

/**
 * Author writing assistant.
 *
 * Three operations exposed to the author UI:
 *
 *   polish(text)       - tighten the abstract and surface concrete suggestions.
 *   titles(abstract)   - propose alternative titles.
 *   keywords(abstract) - extract keywords for indexing.
 */

const llm = require('./llm');
const { run } = require('../db/connection');

async function polish(text, userId) {
  const result = await llm.polishAbstract(text);
  await audit(userId, 'polish_abstract');
  return result;
}

async function titles(abstract, userId, n = 3) {
  const out = await llm.suggestTitles(abstract, n);
  await audit(userId, 'suggest_titles');
  return out;
}

async function keywords(abstract, userId, n = 6) {
  const out = await llm.extractKeywords(abstract, n);
  await audit(userId, 'extract_keywords');
  return out;
}

async function audit(userId, action) {
  await run(
    'INSERT INTO ai_audit (user_id, action, provider) VALUES (?,?,?)',
    [userId || null, action, llm.providerName || 'heuristic']
  );
}

module.exports = { polish, titles, keywords };
