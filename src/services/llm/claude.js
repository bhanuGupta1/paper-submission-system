'use strict';

/**
 * Anthropic Claude backend.
 *
 * Activates only when LLM_PROVIDER=claude AND ANTHROPIC_API_KEY is set
 * AND @anthropic-ai/sdk is installed. Falls back gracefully (the
 * provider switch handles that) so the rest of the codebase can assume
 * the same interface as the heuristic backend.
 *
 * All methods log a row to the `ai_audit` table via the caller; no PII
 * is sent beyond the abstract / title that the author already submitted.
 */

const config = require('../../config');
const logger = require('../../utils/logger');
const heuristic = require('./heuristic');

// Lazy-load the SDK so the app boots even when it isn't installed.
let Anthropic;
try {
  // eslint-disable-next-line global-require
  Anthropic = require('@anthropic-ai/sdk');
} catch (_e) {
  throw new Error(
    '@anthropic-ai/sdk is not installed. Run `npm install @anthropic-ai/sdk` ' +
      'or set LLM_PROVIDER=heuristic.'
  );
}

const client = new Anthropic({ apiKey: config.llm.anthropic.apiKey });
const MODEL = config.llm.anthropic.model;

async function complete(systemPrompt, userPrompt, { maxTokens = 800 } = {}) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });
  // Concatenate all text blocks.
  return response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

function safeJson(s, fallback) {
  try {
    const match = s.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    return JSON.parse(match[0]);
  } catch (_e) {
    return fallback;
  }
}

async function draftReview(paper) {
  const sys =
    'You are an expert peer reviewer for an academic conference. ' +
    'Produce a structured first-pass review that helps a human reviewer get started. ' +
    'Be concrete, fair, and grounded only in the supplied text. Never fabricate citations or facts.';
  const prompt = `Paper title: ${paper.title}
Abstract: ${paper.abstract}

Return STRICT JSON with these keys:
- "summary" (string, 2-3 sentences)
- "strengths" (string, bullet points joined by "\\n- ")
- "weaknesses" (string, same format)
- "novelty_score" (1-5 integer)
- "clarity_score" (1-5 integer)
- "significance_score" (1-5 integer)
- "recommendation" (one of: accept, minor_revisions, major_revisions, reject)`;
  try {
    const text = await complete(sys, prompt, { maxTokens: 700 });
    const parsed = safeJson(text, null);
    if (!parsed) throw new Error('Could not parse model output');
    return { ...parsed, provider: 'claude' };
  } catch (err) {
    logger.warn({ err: err.message }, 'Claude draftReview failed; falling back to heuristic');
    return heuristic.draftReview(paper);
  }
}

async function summarize(text, numSentences = 3) {
  const sys = 'You produce concise, faithful summaries of academic abstracts.';
  const prompt = `Summarise the following in ${numSentences} sentences. Do not add information.\n\n${text}`;
  try {
    return await complete(sys, prompt, { maxTokens: 250 });
  } catch (err) {
    logger.warn({ err: err.message }, 'Claude summarize failed; falling back');
    return heuristic.summarize(text, numSentences);
  }
}

async function extractKeywords(text, n = 6) {
  const sys = 'You extract concise topical keywords from academic text.';
  const prompt = `Return exactly ${n} keywords as a JSON array of strings.\n\n${text}`;
  try {
    const out = await complete(sys, prompt, { maxTokens: 200 });
    const parsed = safeJson(`{"k":${out.match(/\[[\s\S]*\]/)?.[0] || '[]'}}`, { k: [] });
    return parsed.k.slice(0, n);
  } catch (err) {
    logger.warn({ err: err.message }, 'Claude extractKeywords failed; falling back');
    return heuristic.extractKeywords(text, n);
  }
}

async function polishAbstract(text) {
  const sys = 'You are an academic writing editor. Tighten prose without changing meaning.';
  const prompt = `Revise this abstract for clarity and concision. ` +
    `Return JSON with "revised" (string) and "suggestions" (array of short strings).\n\n${text}`;
  try {
    const out = await complete(sys, prompt, { maxTokens: 700 });
    return safeJson(out, { revised: text, suggestions: [] });
  } catch (err) {
    logger.warn({ err: err.message }, 'Claude polishAbstract failed; falling back');
    return heuristic.polishAbstract(text);
  }
}

async function suggestTitles(abstract, n = 3) {
  const sys = 'You craft precise, descriptive academic paper titles.';
  const prompt = `Based on this abstract, propose ${n} alternative titles. ` +
    `Return a JSON array of strings only.\n\n${abstract}`;
  try {
    const out = await complete(sys, prompt, { maxTokens: 200 });
    const arr = safeJson(`{"k":${out.match(/\[[\s\S]*\]/)?.[0] || '[]'}}`, { k: [] });
    return arr.k.slice(0, n);
  } catch (err) {
    logger.warn({ err: err.message }, 'Claude suggestTitles failed; falling back');
    return heuristic.suggestTitles(abstract, n);
  }
}

module.exports = { draftReview, summarize, extractKeywords, polishAbstract, suggestTitles };
