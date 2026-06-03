'use strict';

/**
 * LLM provider switch.
 *
 * Selected via `LLM_PROVIDER`:
 *   - "groq"        (default) — Groq LPU cloud via GROQ_API_KEY
 *                               Defaults to llama-3.3-70b-versatile; override with GROQ_MODEL
 *   - "heuristic"             — offline rule-based, zero cost
 *   - "claude"                — Claude API via ANTHROPIC_API_KEY
 *   - "openrouter"            — OpenRouter API via OPENROUTER_API_KEY
 *                               Defaults to free-tier model; override with OPENROUTER_MODEL
 *
 * Every backend exposes: draftReview, summarize, extractKeywords,
 *                        polishAbstract, suggestTitles
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
} else if (config.llm.provider === 'claude') {
  try {
    if (!config.llm.anthropic.apiKey) {
      logger.warn('LLM_PROVIDER=claude but ANTHROPIC_API_KEY is empty; falling back to heuristic');
    } else {
      backend = require('./claude');
      providerName = 'claude';
      logger.info({ model: config.llm.anthropic.model }, 'LLM provider: Anthropic Claude');
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'Could not load Claude backend; falling back to heuristic');
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

module.exports = backend;
module.exports.providerName = providerName;
