'use strict';

/**
 * LLM provider switch.
 *
 * Selected via `LLM_PROVIDER`:
 *   - "groq"        (default) — Groq LPU cloud via GROQ_API_KEY
 *                               Defaults to llama-3.3-70b-versatile; override with GROQ_MODEL
 *   - "heuristic"             — offline rule-based, zero cost
 *   - "openrouter"            — OpenRouter API via OPENROUTER_API_KEY
 *                               Defaults to free-tier model; override with OPENROUTER_MODEL
 *
 * Every backend exposes: draftReview, summarize, extractKeywords,
 *                        polishAbstract, suggestTitles
 *
 * Per-feature API/offline routing
 * -------------------------------
 * `forFeature(feature)` returns the backend that should handle a given feature,
 * honouring the global `AI_PREFER_API` default and per-feature `AI_FEATURE_*`
 * overrides (resolved by config.useApiFor). When no hosted provider is active
 * (LLM_PROVIDER=heuristic or the key is missing) every feature resolves to the
 * offline heuristic, so the switch can never break the zero-cost default.
 *
 *   const be = llm.forFeature('review');   // groq | openrouter | heuristic
 *   const out = await be.draftReview(paper);
 *   audit(be.providerName);                // 'groq' | 'openrouter' | 'heuristic'
 */

const config = require('../../config');
const logger = require('../../utils/logger');
const heuristic = require('./heuristic');

let backend = heuristic;
let providerName = 'heuristic';

if (config.llm.provider === 'groq') {
  if (!config.llm.groq.apiKey) {
    logger.warn('LLM_PROVIDER=groq but GROQ_API_KEY is empty; falling back to heuristic');
  } else {
    backend = require('./groq');
    providerName = 'groq';
    logger.info({ model: config.llm.groq.model }, 'LLM provider: Groq');
  }
} else if (config.llm.provider === 'openrouter') {
  if (!config.llm.openrouter.apiKey) {
    logger.warn('LLM_PROVIDER=openrouter but OPENROUTER_API_KEY is empty; falling back to heuristic');
  } else {
    backend = require('./openrouter');
    providerName = 'openrouter';
    logger.info({ model: config.llm.openrouter.model }, 'LLM provider: OpenRouter');
  }
} else {
  logger.info('LLM provider: heuristic (offline, zero-cost)');
}

// True when a hosted API backend is active (i.e. not the offline heuristic).
const usingApi = providerName !== 'heuristic';

// Tag both modules so callers can audit which provider actually ran.
heuristic.providerName = 'heuristic';
backend.providerName = providerName;

/**
 * Resolve the backend for a single feature.
 *   - No API provider active -> heuristic for everything.
 *   - API active             -> API backend when config.useApiFor(feature) is
 *                               true, otherwise the heuristic fallback.
 */
function forFeature(feature) {
  if (!usingApi) return heuristic;
  return config.useApiFor(feature) ? backend : heuristic;
}

module.exports = backend;
module.exports.providerName = providerName;
module.exports.usingApi = usingApi;
module.exports.heuristic = heuristic;
module.exports.forFeature = forFeature;
