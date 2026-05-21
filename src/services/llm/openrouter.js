'use strict';

const config = require('../../config');
const logger = require('../../utils/logger');
const heuristic = require('./heuristic');

const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const PRIMARY_MODEL = config.llm.openrouter.model;
const API_KEY = config.llm.openrouter.apiKey;

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
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }),
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
      throw err;
    }
  }
  throw lastErr;
}

function safeJson(s, fallback) {
  try {
    const m = s.match(/\{[\s\S]*\}/);
    if (!m) return fallback;
    return JSON.parse(m[0]);
  } catch (_) { return fallback; }
}

async function draftReview(paper) {
  const sys = `You are an expert academic peer reviewer. Output ONLY valid JSON with these keys:
{"summary":"string","strengths":["string"],"weaknesses":["string"],"novelty_score":1-10,"clarity_score":1-10,"significance_score":1-10,"recommendation":"accept|reject|revisions"}`;
  const user = `Title: ${paper.title}\nAuthors: ${paper.authors || 'Unknown'}\nAbstract: ${paper.abstract || ''}\nKeywords: ${paper.keywords || 'none'}`;
  try {
    const raw = await complete(sys, user, { maxTokens: 600 });
    return safeJson(raw, heuristic.draftReview(paper));
  } catch (err) {
    logger.error({ err: err.message }, '[openrouter] draftReview failed');
    return heuristic.draftReview(paper);
  }
}

async function summarize(text, n = 3) {
  if (!text || text.length < 100) return heuristic.summarize(text, n);
  const sys = `Summarize the following in ${n} sentence${n !== 1 ? 's' : ''}. Output only the summary.`;
  try { return await complete(sys, text.slice(0, 4000), { maxTokens: 300 }); }
  catch (err) { logger.error({ err: err.message }, '[openrouter] summarize failed'); return heuristic.summarize(text, n); }
}

async function extractKeywords(text, n = 8) {
  if (!text) return heuristic.extractKeywords(text, n);
  const sys = `Extract up to ${n} academic keywords. Output ONLY a JSON array of strings.`;
  try {
    const raw = await complete(sys, text.slice(0, 3000), { maxTokens: 150 });
    const arr = JSON.parse((raw.match(/\[[\s\S]*\]/) || ['[]'])[0]);
    return Array.isArray(arr) && arr.length > 0 ? arr.slice(0, n) : heuristic.extractKeywords(text, n);
  } catch (err) { logger.error({ err: err.message }, '[openrouter] extractKeywords failed'); return heuristic.extractKeywords(text, n); }
}

async function polishAbstract(text) {
  if (!text) return heuristic.polishAbstract(text);
  const sys = 'Polish this academic abstract. Return JSON: { "revised": "...", "suggestions": ["..."] }. Output ONLY valid JSON.';
  try {
    const raw = await complete(sys, text.slice(0, 2000), { maxTokens: 500 });
    return safeJson(raw, heuristic.polishAbstract(text));
  } catch (err) { logger.error({ err: err.message }, '[openrouter] polishAbstract failed'); return heuristic.polishAbstract(text); }
}

async function suggestTitles(abstract) {
  if (!abstract) return heuristic.suggestTitles(abstract);
  const sys = 'Suggest 5 alternative academic paper titles. Output ONLY a JSON array of strings.';
  try {
    const raw = await complete(sys, abstract.slice(0, 1500), { maxTokens: 200 });
    const arr = JSON.parse((raw.match(/\[[\s\S]*\]/) || ['[]'])[0]);
    return Array.isArray(arr) && arr.length > 0 ? arr.slice(0, 5) : heuristic.suggestTitles(abstract);
  } catch (err) { logger.error({ err: err.message }, '[openrouter] suggestTitles failed'); return heuristic.suggestTitles(abstract); }
}

async function generateDecisionLetter(paper, reviews, suggestion, explanation) {
  const revText = reviews.slice(0, 5).map((r, i) => {
    const parts = [];
    if (r.summary) parts.push('Summary: ' + r.summary);
    if (r.strengths) parts.push('Strengths: ' + r.strengths);
    if (r.weaknesses) parts.push('Weaknesses: ' + r.weaknesses);
    return `Reviewer ${i + 1} (${r.recommendation}): ${parts.join('. ')}`;
  }).join('\n---\n');
  const sys = 'You are an academic journal editor. Write a professional editorial decision letter body to the author (2-4 paragraphs, no salutation or signature). Be specific, constructive, and actionable.';
  const user = `Paper: "${paper.title}"\nDecision: ${suggestion}\nContext: ${(explanation || []).join(' ')}\n\nReviewer feedback:\n${revText}`;
  try { return await complete(sys, user, { maxTokens: 500 }); }
  catch (err) { logger.error({ err: err.message }, '[openrouter] generateDecisionLetter failed'); return null; }
}

async function summarizeReviews(paper, reviews) {
  if (!reviews || reviews.length === 0) return null;
  const revText = reviews.slice(0, 6).map((r, i) => {
    const parts = [];
    if (r.summary) parts.push(r.summary);
    if (r.strengths) parts.push('Strengths: ' + r.strengths);
    if (r.weaknesses) parts.push('Weaknesses: ' + r.weaknesses);
    return `Reviewer ${i + 1} (${r.recommendation}): ${parts.join('. ')}`;
  }).join('\n---\n');
  const sys = 'Summarize the key themes, consensus, and disagreements across these peer reviews in 3-5 sentences.';
  const user = `Paper: "${paper.title}"\n\nReviews:\n${revText}`;
  try { return await complete(sys, user, { maxTokens: 300 }); }
  catch (err) { logger.error({ err: err.message }, '[openrouter] summarizeReviews failed'); return null; }
}

module.exports = { draftReview, summarize, extractKeywords, polishAbstract, suggestTitles, generateDecisionLetter, summarizeReviews };
