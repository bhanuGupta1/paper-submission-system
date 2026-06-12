'use strict';

/**
 * Unified embeddings service — one entry point for every similarity feature
 * (reviewer matching, plagiarism similarity, smart search).
 *
 * It hides *which* backend is in use behind a single `buildSpace(corpus)` call:
 *
 *   EMBEDDINGS_PROVIDER=tfidf   (default) pure-JS TF-IDF, offline, zero cost
 *   EMBEDDINGS_PROVIDER=st                sentence-transformers (local model)
 *   EMBEDDINGS_PROVIDER=openai|jina|voyage|mistral|gemini|nomic|custom
 *                                         real API embeddings (OpenAI-compatible)
 *
 * Any API/ST failure (missing key, network error, dependency not installed)
 * falls back to TF-IDF automatically, so callers never have to branch and the
 * feature keeps working offline.
 *
 *   const space = await buildSpace(corpusTexts);   // embeds the corpus
 *   const qv    = await space.query(newText);      // same vector space
 *   const sim   = space.cosine(qv, space.vectors[i]);
 *   space.backend  // 'tfidf' | 'st' | 'api:<provider>'
 */

const config = require('../config');
const logger = require('../utils/logger');
const tfidf = require('./embeddings');
const st = require('./embeddings-st');
const api = require('./embeddingsApi');

// Robust cosine for dense numeric vectors (API / sentence-transformers).
// Divides by magnitudes so it is correct whether or not inputs are normalised.
function cosineDense(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// tfidf | st | api — what the configured provider maps to.
function providerKind() {
  const p = (config.embeddings.provider || 'tfidf').toLowerCase();
  if (p === '' || p === 'tfidf') return 'tfidf';
  if (p === 'st') return 'st';
  return 'api';
}

// True when a real API provider is selected AND fully configured. Consumers
// that are happy with their own offline path (e.g. smart search) use this to
// decide whether opting into the shared service is worthwhile.
function usingApiEmbeddings() {
  return providerKind() === 'api' && api.isConfigured();
}

// ---- backends ------------------------------------------------------------

// Corpus-relative TF-IDF. `query` must use the corpus idf so a new document
// lands in the same space as the fitted vectors.
function buildTfidfSpace(texts) {
  const { vectors, idf } = tfidf.buildModel(texts);
  return {
    backend: 'tfidf',
    vectors,
    query: async (text) => tfidf.embed(text, idf),
    cosine: tfidf.cosine,
  };
}

// Real API embeddings. Each text -> one dense vector, independent of corpus.
async function buildApiSpace(texts) {
  const vectors = texts.length ? await api.embedMany(texts) : [];
  const { provider } = api.resolve();
  return {
    backend: `api:${provider || 'custom'}`,
    vectors,
    query: async (text) => api.embedOne(text),
    cosine: cosineDense,
  };
}

// Local sentence-transformers. Returns null when the dependency/model is
// unavailable so the caller can fall back to TF-IDF.
async function buildStSpace(texts) {
  await st.init();
  // st.embed() returns null until the model is loaded; probe once.
  const probe = await st.embed('readiness probe');
  if (probe == null) return null;
  const vectors = [];
  for (const t of texts) {
    // eslint-disable-next-line no-await-in-loop
    vectors.push(await st.embed(t));
  }
  return {
    backend: 'st',
    vectors,
    query: async (text) => st.embed(text),
    cosine: cosineDense,
  };
}

// ---- public entry point --------------------------------------------------

/**
 * Embed a corpus and return a space you can query against.
 * Always resolves to a working space — TF-IDF is the guaranteed fallback.
 */
async function buildSpace(corpusTexts) {
  const texts = Array.isArray(corpusTexts) ? corpusTexts : [];
  const kind = providerKind();

  if (kind === 'api' && api.isConfigured()) {
    try {
      const space = await buildApiSpace(texts);
      logger.info({ backend: space.backend, docs: texts.length }, 'embeddings: API space ready');
      return space;
    } catch (err) {
      logger.warn({ err: err.message }, 'embeddings: API backend failed; falling back to TF-IDF');
    }
  } else if (kind === 'st') {
    try {
      const space = await buildStSpace(texts);
      if (space) return space;
      logger.warn('embeddings: sentence-transformers unavailable; falling back to TF-IDF');
    } catch (err) {
      logger.warn({ err: err.message }, 'embeddings: sentence-transformers failed; falling back to TF-IDF');
    }
  }

  return buildTfidfSpace(texts);
}

module.exports = {
  buildSpace,
  cosineDense,
  providerKind,
  usingApiEmbeddings,
};
