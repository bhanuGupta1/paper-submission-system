'use strict';

/**
 * LLM provider switch.
 *
 * Selects a backend based on `LLM_PROVIDER`:
 *   - "heuristic"  (default) -- pure-JS, fully offline, zero-cost.
 *                              Ships rule-based templates that mirror the
 *                              shape of an LLM response so the UI is
 *                              unchanged when an API key is later added.
 *   - "claude"               -- calls Anthropic via @anthropic-ai/sdk.
 *
 * Every backend exposes the same interface:
 *
 *   draftReview(paper)         -> { summary, strengths, weaknesses,
 *                                   novelty_score, clarity_score,
 *                                   significance_score, recommendation }
 *   summarize(text, n)         -> string
 *   extractKeywords(text, n)   -> string[]
 *   polishAbstract(text)       -> { revised, suggestions[] }
 *   suggestTitles(abstract)    -> string[]
 */

const config = require('../../config');
const logger = require('../../utils/logger');
const heuristic = require('./heuristic');

let backend = heuristic;

if (config.llm.provider === 'claude') {
  try {
    if (!config.llm.anthropic.apiKey) {
      logger.warn('LLM_PROVIDER=claude but ANTHROPIC_API_KEY is empty; falling back to heuristic');
    } else {
      backend = require('./claude');
      logger.info({ model: config.llm.anthropic.model }, 'LLM provider: Anthropic Claude');
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'Could not load Claude backend; falling back to heuristic');
    backend = heuristic;
  }
} else {
  logger.info('LLM provider: heuristic (offline, zero-cost)');
}

module.exports = backend;
module.exports.providerName = backend === heuristic ? 'heuristic' : 'claude';
