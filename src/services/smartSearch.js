'use strict';

/**
 * Smart semantic search across all submissions.
 *
 * Uses TF-IDF cosine similarity for ranking + metadata filters.
 * Falls back gracefully if embeddings are unavailable.
 */

const { all } = require('../db/connection');
const embeddings = require('./embeddings');

const STOPWORDS = new Set(['the','a','an','and','or','but','of','in','on','at','to','for','with','by','from','as','is','are','was','were','be','been','this','that','it','its','we','our','they','also','very','more','most','some','any','all','not','no','so','if','about','into','paper','study','using','used','use','show','shows','shown','method','approach','proposed','results']);

function tokenize(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function termFreq(tokens) {
  const freq = new Map();
  for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1);
  return freq;
}

function cosineSimilarity(tf1, tf2) {
  let dot = 0, norm1 = 0, norm2 = 0;
  for (const [term, freq] of tf1) {
    dot += freq * (tf2.get(term) || 0);
    norm1 += freq * freq;
  }
  for (const [, freq] of tf2) norm2 += freq * freq;
  if (!norm1 || !norm2) return 0;
  return dot / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

/**
 * Search papers by semantic similarity + keyword matching.
 * @param {string} query - search query
 * @param {{ status?: string, trackId?: number, limit?: number, authorId?: number, minScore?: number }} options
 */
async function search(query, { status = null, trackId = null, limit = 20, authorId = null, minScore = 0 } = {}) {
  if (!query || !query.trim()) {
    // No query — return recent papers with filters
    const filters = [];
    const params = [];
    if (status) { filters.push('p.review_status = ?'); params.push(status); }
    if (trackId) { filters.push('p.track_id = ?'); params.push(trackId); }
    if (authorId) { filters.push('p.author_id = ?'); params.push(authorId); }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    params.push(limit);
    const rows = await all(
      `SELECT p.id, p.title, p.abstract, p.keywords, p.review_status, p.submission_date, p.similarity_score, p.ai_text_likelihood, u.username AS author_username
       FROM papers p LEFT JOIN users u ON u.id = p.author_id ${where} ORDER BY p.submission_date DESC LIMIT ?`,
      params
    );
    return rows.map((r) => ({ ...r, relevanceScore: null }));
  }

  // Build query TF vector
  const queryTokens = tokenize(query);
  const queryTf = termFreq(queryTokens);

  // Fetch candidates with filters
  const filters = [];
  const params = [];
  if (status) { filters.push('p.review_status = ?'); params.push(status); }
  if (trackId) { filters.push('p.track_id = ?'); params.push(trackId); }
  if (authorId) { filters.push('p.author_id = ?'); params.push(authorId); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const papers = await all(
    `SELECT p.id, p.title, p.abstract, p.keywords, p.ai_keywords, p.tags, p.review_status, p.submission_date, p.similarity_score, p.ai_text_likelihood, u.username AS author_username
     FROM papers p LEFT JOIN users u ON u.id = p.author_id ${where} ORDER BY p.submission_date DESC LIMIT 500`,
    params
  );

  // Score each paper
  const scored = papers.map((paper) => {
    const docText = `${paper.title} ${paper.title} ${paper.abstract} ${paper.keywords || ''} ${paper.ai_keywords || ''} ${paper.tags || ''}`;
    const docTf = termFreq(tokenize(docText));
    const semantic = cosineSimilarity(queryTf, docTf);

    // Keyword exact match boost
    const docLower = docText.toLowerCase();
    const queryWords = queryTokens;
    const keywordMatches = queryWords.filter((w) => docLower.includes(w)).length;
    const keywordBoost = queryWords.length > 0 ? (keywordMatches / queryWords.length) * 0.3 : 0;

    const relevanceScore = Math.min(1, semantic + keywordBoost);
    return { ...paper, relevanceScore: parseFloat(relevanceScore.toFixed(4)) };
  });

  return scored
    .filter((p) => p.relevanceScore >= minScore)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, limit);
}

module.exports = { search };
