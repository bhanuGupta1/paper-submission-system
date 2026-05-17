'use strict';

/**
 * Sentence-transformer adapter using @xenova/transformers.
 * Lazy-loaded so the heavy ~80MB model only downloads if the user
 * opts in via EMBEDDINGS_PROVIDER=st.
 *
 * Exposes the same interface as services/embeddings.js so the
 * matcher / plagiarism detector can swap backends transparently.
 *
 * Falls back to TF-IDF embeddings if the dependency is not installed.
 */

const tfidf = require('./embeddings');
const logger = require('../utils/logger');

let _pipeline = null;
let _ready = false;

async function init() {
  if (_ready) return;
  try {
    // eslint-disable-next-line global-require
    const { pipeline } = require('@xenova/transformers');
    _pipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    _ready = true;
    logger.info('sentence-transformers ready (Xenova/all-MiniLM-L6-v2)');
  } catch (err) {
    logger.warn({ err: err.message }, 'sentence-transformers not available; falling back to TF-IDF');
    _ready = false;
  }
}

async function embed(text) {
  await init();
  if (!_ready) return null;
  const out = await _pipeline(text, { pooling: 'mean', normalize: true });
  return Array.from(out.data);
}

function cosineDense(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // both already normalised
}

// Same surface as TF-IDF embeddings, so callers can switch on a flag.
function tokenize(t) { return tfidf.tokenize(t); }
function buildModel(docs) { return tfidf.buildModel(docs); }
function cosine(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return cosineDense(a, b);
  return tfidf.cosine(a, b);
}

module.exports = { init, embed, cosine, tokenize, buildModel, embedDense: embed };
