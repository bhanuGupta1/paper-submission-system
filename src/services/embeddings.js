'use strict';

/**
 * TF-IDF embeddings for similarity search and reviewer matching.
 *
 * Pure JavaScript - no API calls, no model downloads, no external deps.
 * Good enough for hundreds-to-thousands of papers, which is the realistic
 * scale of a department- or workshop-level submission system.
 *
 * The interface intentionally mirrors a "real" embeddings API so it can
 * be swapped out for sentence-transformers / OpenAI / Voyage with no
 * caller-side changes.
 */

const STOPWORDS = new Set([
  'the','a','an','and','or','but','of','in','on','at','to','for','with','by','from','as',
  'is','are','was','were','be','been','being','this','that','these','those','it','its',
  'we','our','their','them','they','i','you','your','do','does','did','have','has','had',
  'can','could','should','would','will','may','might','must','than','then','so','if','because',
  'about','into','over','under','between','through','during','before','after','also','very',
  'more','most','such','some','any','all','each','other','same','only','own','no','not',
]);

function tokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * Build a TF-IDF model from a corpus of documents.
 * Returns { vectors, idf, vocab } where vectors[i] is a sparse map.
 */
function buildModel(docs) {
  const tokenized = docs.map(tokenize);
  const df = new Map();
  for (const tokens of tokenized) {
    const seen = new Set(tokens);
    for (const t of seen) df.set(t, (df.get(t) || 0) + 1);
  }
  const N = Math.max(1, docs.length);
  const idf = new Map();
  for (const [t, count] of df.entries()) {
    idf.set(t, Math.log(1 + N / count));
  }
  const vectors = tokenized.map((tokens) => {
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    const v = new Map();
    let norm = 0;
    for (const [t, count] of tf.entries()) {
      const w = (count / tokens.length) * (idf.get(t) || 0);
      if (w > 0) {
        v.set(t, w);
        norm += w * w;
      }
    }
    norm = Math.sqrt(norm) || 1;
    for (const [t, w] of v.entries()) v.set(t, w / norm);
    return v;
  });
  return { vectors, idf };
}

/**
 * Embed a single document into the same vector space as a fitted model.
 * Used when classifying a *new* paper against an existing corpus.
 */
function embed(text, idf) {
  const tokens = tokenize(text);
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  const v = new Map();
  let norm = 0;
  for (const [t, count] of tf.entries()) {
    const w = (count / Math.max(1, tokens.length)) * (idf.get(t) || 0);
    if (w > 0) {
      v.set(t, w);
      norm += w * w;
    }
  }
  norm = Math.sqrt(norm) || 1;
  for (const [t, w] of v.entries()) v.set(t, w / norm);
  return v;
}

function cosine(a, b) {
  if (!a || !b) return 0;
  // Iterate over the smaller map for speed.
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [t, w] of small.entries()) {
    const w2 = large.get(t);
    if (w2) dot += w * w2;
  }
  return dot;
}

module.exports = { tokenize, buildModel, embed, cosine };
