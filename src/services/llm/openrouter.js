'use strict';

/**
 * OpenRouter backend — OpenAI-compatible API via https://openrouter.ai
 *
 * Activates when LLM_PROVIDER=openrouter and OPENROUTER_API_KEY is set.
 * Defaults to a free-tier model. Override with OPENROUTER_MODEL env var.
 *
 * Free models available on OpenRouter (no credit required):
 *   meta-llama/llama-3.3-70b-instruct:free
 *   google/gemini-2.0-flash-exp:free
 *   deepseek/deepseek-r1:free  (reasoning, slower)
 *   qwen/qwq-32b:free
 */

const config = require('../../config');
const logger = require('../../utils/logger');
const heuristic = require('./heuristic');

const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const PRIMARY_MODEL = config.llm.openrouter.model;
const API_KEY = config.llm.openrouter.apiKey;

// Fallback free models tried in order when the primary is rate-limited
const FALLBACK_MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemma-4-31b-it:free',
  'nousresearch/hermes-3-llama-3.1-405b:free',
  'meta-llama/llama-3.2-3b-instruct:free',
].filter((m) => m !== PRIMARY_MODEL);

async function callModel(model, systemPrompt, userPrompt, maxTokens) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': config.appUrl || 'http://localhost:3000',
      'X-Title': 'PaperSub.AI',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    const err = new Error(`OpenRouter API error ${res.status}: ${errText}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  if (!data.choices || !data.choices[0]) throw new Error('No choices in OpenRouter response');
  return (data.choices[0].message.content || '').trim();
}

async function complete(systemPrompt, userPrompt, { maxTokens = 800 } = {}) {
  const models = [PRIMARY_MODEL, ...FALLBACK_MODELS];
  let lastErr;
  for (const model of models) {
    try {
      const result = await callModel(model, systemPrompt, userPrompt, maxTokens);
      if (model !== PRIMARY_MODEL) logger.info({ model }, '[openrouter] Used fallback model');
      return result;
    } catch (err) {
      lastErr = err;
      if (err.status === 429 || err.status === 404) {
        logger.warn({ model, err: err.message }, '[openrouter] Model unavailable, trying next');
        continue;
      }
      throw err; // non-rate-limit errors are re-thrown immediately
    }
  }
  throw lastErr;
}

function safeJson(s, fallback) {
  try {
    const match = s.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    return JSON.parse(match[0]);
  } catch (_) {
    return fallback;
  }
}

async function draftReview(paper) {
  const sys = `You are an expert academic peer reviewer. Given a paper's title, abstract, and keywords, produce a structured review in JSON. Be specific, constructive, and fair. Output ONLY valid JSON with these exact keys:
{
  "summary": "string",
  "strengths": ["string"],
  "weaknesses": ["string"],
  "novelty_score": number 1-10,
  "clarity_score": number 1-10,
  "significance_score": number 1-10,
  "recommendation": "accept" | "reject" | "revisions"
}`;
  const user = `Title: ${paper.title}\nAuthors: ${paper.authors || 'Unknown'}\nAbstract: ${paper.abstract || '(no abstract)'}\nKeywords: ${paper.keywords || 'none'}`;
  try {
    const raw = await complete(sys, user, { maxTokens: 600 });
    return safeJson(raw, heuristic.draftReview(paper));
  } catch (err) {
    logger.error({ err: err.message }, '[openrouter] draftReview failed — heuristic fallback');
    return heuristic.draftReview(paper);
  }
}

async function summarize(text, n = 3) {
  if (!text || text.length < 100) return heuristic.summarize(text, n);
  const sys = 'You are an academic writing assistant. Summarize the following text in plain English in exactly the requested number of sentences. Output only the summary, no preamble.';
  const user = `Summarize in ${n} sentence${n !== 1 ? 's' : ''}:\n\n${text.slice(0, 4000)}`;
  try {
    return await complete(sys, user, { maxTokens: 300 });
  } catch (err) {
    logger.error({ err: err.message }, '[openrouter] summarize failed — heuristic fallback');
    return heuristic.summarize(text, n);
  }
}

async function extractKeywords(text, n = 8) {
  if (!text) return heuristic.extractKeywords(text, n);
  const sys = 'You are an academic keyword extractor. Output ONLY a JSON array of strings — the top keywords from the text. No explanation.';
  const user = `Extract up to ${n} keywords from:\n\n${text.slice(0, 3000)}`;
  try {
    const raw = await complete(sys, user, { maxTokens: 150 });
    const arr = JSON.parse(raw.match(/\[[\s\S]*\]/)?.[0] || '[]');
    return Array.isArray(arr) && arr.length > 0 ? arr.slice(0, n) : heuristic.extractKeywords(text, n);
  } catch (err) {
    logger.error({ err: err.message }, '[openrouter] extractKeywords failed — heuristic fallback');
    return heuristic.extractKeywords(text, n);
  }
}

async function polishAbstract(text) {
  if (!text) return heuristic.polishAbstract(text);
  const sys = `You are an academic writing coach. Given an abstract, return JSON with:
{ "revised": "the improved abstract", "suggestions": ["suggestion 1", "suggestion 2", ...] }
Output ONLY valid JSON.`;
  const user = `Polish this abstract:\n\n${text.slice(0, 2000)}`;
  try {
    const raw = await complete(sys, user, { maxTokens: 500 });
    return safeJson(raw, heuristic.polishAbstract(text));
  } catch (err) {
    logger.error({ err: err.message }, '[openrouter] polishAbstract failed — heuristic fallback');
    return heuristic.polishAbstract(text);
  }
}

async function suggestTitles(abstract) {
  if (!abstract) return heuristic.suggestTitles(abstract);
  const sys = 'You are an academic title generator. Output ONLY a JSON array of 5 alternative paper titles. No explanation.';
  const user = `Suggest 5 academic titles for this abstract:\n\n${abstract.slice(0, 1500)}`;
  try {
    const raw = await complete(sys, user, { maxTokens: 200 });
    const arr = JSON.parse(raw.match(/\[[\s\S]*\]/)?.[0] || '[]');
    return Array.isArray(arr) && arr.length > 0 ? arr.slice(0, 5) : heuristic.suggestTitles(abstract);
  } catch (err) {
    logger.error({ err: err.message }, '[openrouter] suggestTitles failed — heuristic fallback');
    return heuristic.suggestTitles(abstract);
  }
}

module.exports = { draftReview, summarize, extractKeywords, polishAbstract, suggestTitles };
