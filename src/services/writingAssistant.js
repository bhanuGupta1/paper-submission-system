'use strict';

/**
 * Author writing assistant.
 *
 * Three operations exposed to the author UI:
 *
 *   polish(text)         - tighten the abstract and surface concrete suggestions.
 *   titles(abstract)     - propose alternative titles.
 *   keywords(abstract)   - extract keywords for indexing.
 *   extractMetadata(text)- pull title/authors/abstract/keywords/tags from a manuscript.
 */

const llm = require('./llm');
const { run } = require('../db/connection');

async function polish(text, userId) {
  const be = llm.forFeature('abstract');
  const result = await be.polishAbstract(text);
  await audit(userId, 'polish_abstract', be);
  return result;
}

async function titles(abstract, userId, n = 3) {
  const be = llm.forFeature('titles');
  const out = await be.suggestTitles(abstract, n);
  await audit(userId, 'suggest_titles', be);
  return out;
}

async function keywords(abstract, userId, n = 6) {
  const be = llm.forFeature('keywords');
  const out = await be.extractKeywords(abstract, n);
  await audit(userId, 'extract_keywords', be);
  return out;
}

async function extractMetadata(fullText, userId) {
  const be = llm.forFeature('metadata');
  const hasOwn = typeof be.extractMetadata === 'function';
  const extractor = hasOwn ? be.extractMetadata : llm.heuristic.extractMetadata;
  const out = await extractor(fullText);
  await audit(userId, 'metadata_extract', hasOwn ? be : llm.heuristic);
  return out;
}

// `be` is the backend that actually ran (from llm.forFeature); fall back to the
// global providerName if a caller omits it.
async function audit(userId, action, be) {
  await run(
    'INSERT INTO ai_audit (user_id, action, provider) VALUES (?,?,?)',
    [userId || null, action, (be && be.providerName) || llm.providerName || 'heuristic']
  );
}

module.exports = { polish, titles, keywords, extractMetadata };
