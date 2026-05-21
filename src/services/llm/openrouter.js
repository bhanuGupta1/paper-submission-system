'use strict';

/**
 * OpenRouter backend with task-specific model routing.
 * Each task uses the best free-tier model for that workload.
 */

const config = require('../../config');
const logger = require('../../utils/logger');
const heuristic = require('./heuristic');

const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const API_KEY = config.llm.openrouter.apiKey;

// Task-specific free models — verified live as of 2026-05-22
const MODELS = {
  analysis:      'meta-llama/llama-3.3-70b-instruct:free',
  summarization: 'meta-llama/llama-3.2-3b-instruct:free',
  similarity:    'google/gemma-4-31b-it:free',
  matching:      'meta-llama/llama-3.3-70b-instruct:free',
  quality:       'meta-llama/llama-3.3-70b-instruct:free',
  citation:      'meta-llama/llama-3.3-70b-instruct:free',
  tone:          'google/gemma-4-31b-it:free',
  decision:      'meta-llama/llama-3.3-70b-instruct:free',
  default:       config.llm.openrouter.model || 'meta-llama/llama-3.3-70b-instruct:free',
};

// Ordered by capability; all verified live 2026-05-22
const FALLBACK_MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'nousresearch/hermes-3-llama-3.1-405b:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'qwen/qwen3-next-80b-a3b-instruct:free',
  'google/gemma-4-31b-it:free',
  'meta-llama/llama-3.2-3b-instruct:free',
];

// Strip control characters and obvious prompt-injection attempts from user text
function sanitize(str, maxLen = 4000) {
  if (!str) return '';
  return String(str)
    .slice(0, maxLen)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/\b(ignore (?:all |previous |prior )?instructions?|you are now|forget (?:all|everything|prior)|system prompt|<\/?s(?:ystem|ys)>)/gi, '[filtered]');
}

function safeJson(raw, fallback) {
  if (!raw) return fallback;
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : fallback;
  } catch (_) { return fallback; }
}

async function callModel(model, systemPrompt, userPrompt, maxTokens, stream = false) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + API_KEY,
      'Content-Type': 'application/json',
      'HTTP-Referer': config.appUrl || 'http://localhost:3000',
      'X-Title': 'PaperSub.AI',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      stream,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    const err = new Error('OpenRouter ' + res.status + ': ' + txt);
    err.status = res.status;
    throw err;
  }
  if (stream) return res; // caller handles the ReadableStream
  const data = await res.json();
  if (!data.choices || !data.choices[0]) throw new Error('No choices in response');
  return (data.choices[0].message.content || '').trim();
}

async function complete(systemPrompt, userPrompt, { maxTokens = 800, taskType = 'default' } = {}) {
  const primary = MODELS[taskType] || MODELS.default;
  const chain = [primary, ...FALLBACK_MODELS.filter(m => m !== primary)];
  let lastErr;
  for (const model of chain) {
    try {
      const result = await callModel(model, systemPrompt, userPrompt, maxTokens);
      if (model !== primary) logger.info({ model, taskType }, '[openrouter] fallback model used');
      return result;
    } catch (err) {
      lastErr = err;
      if (err.status === 429 || err.status === 404) { logger.warn({ model, taskType }, '[openrouter] model unavailable, trying next'); continue; }
      throw err;
    }
  }
  throw lastErr;
}

// ── Existing functions (keep backward compat) ──────────────────────────────

async function draftReview(paper) {
  const sys = 'You are an expert academic peer reviewer. Output ONLY valid JSON: {"summary":"string","strengths":["string"],"weaknesses":["string"],"novelty_score":1,"clarity_score":1,"significance_score":1,"recommendation":"accept|reject|revisions","confidence":85}';
  const user = 'Title: ' + sanitize(paper.title, 200) + '\nAbstract: ' + sanitize(paper.abstract, 2000) + '\nKeywords: ' + sanitize(paper.keywords, 200);
  try { const raw = await complete(sys, user, { maxTokens: 700, taskType: 'analysis' }); return safeJson(raw, heuristic.draftReview(paper)); }
  catch (err) { logger.error({ err: err.message }, '[openrouter] draftReview failed'); return heuristic.draftReview(paper); }
}

async function summarize(text, n = 3) {
  if (!text || text.length < 100) return heuristic.summarize(text, n);
  try { return await complete('Summarize in ' + n + ' sentences. Output only the summary.', sanitize(text, 4000), { maxTokens: 300, taskType: 'summarization' }); }
  catch (err) { logger.error({ err: err.message }, '[openrouter] summarize failed'); return heuristic.summarize(text, n); }
}

async function extractKeywords(text, n = 8) {
  if (!text) return heuristic.extractKeywords(text, n);
  try {
    const raw = await complete('Extract ' + n + ' academic keywords. Output ONLY a JSON array of strings.', sanitize(text, 3000), { maxTokens: 150, taskType: 'analysis' });
    const arr = JSON.parse((raw.match(/\[[\s\S]*\]/) || ['[]'])[0]);
    return Array.isArray(arr) && arr.length ? arr.slice(0, n) : heuristic.extractKeywords(text, n);
  } catch (err) { logger.error({ err: err.message }, '[openrouter] extractKeywords failed'); return heuristic.extractKeywords(text, n); }
}

async function polishAbstract(text) {
  if (!text) return heuristic.polishAbstract(text);
  const sys = 'Polish this academic abstract. Return ONLY JSON: {"revised":"string","suggestions":["string"],"confidence":80}';
  try { const raw = await complete(sys, sanitize(text, 2000), { maxTokens: 600, taskType: 'analysis' }); return safeJson(raw, heuristic.polishAbstract(text)); }
  catch (err) { logger.error({ err: err.message }, '[openrouter] polishAbstract failed'); return heuristic.polishAbstract(text); }
}

async function suggestTitles(abstract) {
  if (!abstract) return heuristic.suggestTitles(abstract);
  try {
    const raw = await complete('Suggest 5 academic paper titles. Output ONLY a JSON array of strings.', sanitize(abstract, 1500), { maxTokens: 200, taskType: 'analysis' });
    const arr = JSON.parse((raw.match(/\[[\s\S]*\]/) || ['[]'])[0]);
    return Array.isArray(arr) && arr.length ? arr.slice(0, 5) : heuristic.suggestTitles(abstract);
  } catch (err) { logger.error({ err: err.message }, '[openrouter] suggestTitles failed'); return heuristic.suggestTitles(abstract); }
}

async function generateDecisionLetter(paper, reviews, suggestion, explanation) {
  const revText = reviews.slice(0, 5).map((r, i) => 'Reviewer ' + (i+1) + ' (' + r.recommendation + '): ' + [r.summary, r.strengths ? 'Strengths: '+r.strengths : '', r.weaknesses ? 'Weaknesses: '+r.weaknesses : ''].filter(Boolean).join('. ')).join('\n---\n');
  const sys = 'You are an academic journal editor. Write a professional editorial decision letter body (2-4 paragraphs, no salutation or signature). Be specific and constructive.';
  const user = 'Paper: "' + sanitize(paper.title, 200) + '"\nDecision: ' + suggestion + '\nContext: ' + (explanation||[]).join(' ') + '\n\nReviewer feedback:\n' + sanitize(revText, 2000);
  try { return await complete(sys, user, { maxTokens: 600, taskType: 'decision' }); }
  catch (err) { logger.error({ err: err.message }, '[openrouter] generateDecisionLetter failed'); return null; }
}

async function summarizeReviews(paper, reviews) {
  if (!reviews || !reviews.length) return null;
  const revText = reviews.slice(0, 6).map((r, i) => 'Reviewer ' + (i+1) + ' (' + r.recommendation + '): ' + [r.summary, r.strengths ? 'Strengths: '+r.strengths : '', r.weaknesses ? 'Weaknesses: '+r.weaknesses : ''].filter(Boolean).join('. ')).join('\n---\n');
  const sys = 'Summarize peer review consensus and disagreements in 3-5 sentences.';
  const user = 'Paper: "' + sanitize(paper.title, 200) + '"\n\nReviews:\n' + sanitize(revText, 3000);
  try { return await complete(sys, user, { maxTokens: 350, taskType: 'summarization' }); }
  catch (err) { logger.error({ err: err.message }, '[openrouter] summarizeReviews failed'); return null; }
}

// ── NEW: Pre-submission desk rejection check ──────────────────────────────

async function deskRejectionCheck(title, abstract, wordCount, sectionList, referenceCount, hasKeywords) {
  const sys = `You are an expert academic editor performing a desk rejection pre-check.
Analyze the manuscript metadata and return ONLY valid JSON:
{
  "overall_score": 0-100,
  "pass_fail": "PASS"|"WARN"|"FAIL",
  "issues": [{"severity":"HIGH"|"MEDIUM"|"LOW","issue":"string","fix":"string"}],
  "ready_to_submit": true|false,
  "confidence": 0-100,
  "summary": "string"
}
Be strict. Missing abstract, no keywords, or word count outside 3000-12000 should be HIGH severity.`;
  const user = 'Title: ' + sanitize(title, 200) +
    '\nAbstract word count: ' + (abstract ? abstract.split(/\s+/).length : 0) +
    '\nEstimated total word count: ' + (wordCount || 'unknown') +
    '\nDetected sections: ' + sanitize(sectionList || 'unknown', 300) +
    '\nReference count: ' + (referenceCount || 'unknown') +
    '\nKeywords provided: ' + (hasKeywords ? 'yes' : 'no') +
    '\nAbstract excerpt: ' + sanitize(abstract, 800);
  try { return safeJson(await complete(sys, user, { maxTokens: 700, taskType: 'analysis' }), null); }
  catch (err) { logger.error({ err: err.message }, '[openrouter] deskRejectionCheck failed'); return null; }
}

// ── NEW: Ethics & compliance checker ──────────────────────────────────────

async function ethicsCheck(title, abstract, fullText) {
  const sys = `You are a research ethics compliance expert. Analyze the manuscript excerpt and return ONLY valid JSON:
{
  "ethics_statement_present": true|false,
  "coi_statement_present": true|false,
  "funding_acknowledgment_present": true|false,
  "data_availability_present": true|false,
  "issues": [{"severity":"HIGH"|"MEDIUM"|"LOW","issue":"string","recommendation":"string"}],
  "overall_risk": "LOW"|"MEDIUM"|"HIGH",
  "compliance_score": 0-100,
  "confidence": 0-100
}`;
  const combined = 'Title: ' + sanitize(title, 200) + '\n\n' + sanitize((fullText || abstract || ''), 3000);
  try { return safeJson(await complete(sys, combined, { maxTokens: 600, taskType: 'analysis' }), null); }
  catch (err) { logger.error({ err: err.message }, '[openrouter] ethicsCheck failed'); return null; }
}

// ── NEW: Citation hallucination detector ──────────────────────────────────

async function citationHallucinationCheck(references) {
  if (!references || !references.trim()) return null;
  const sys = `You are a citation verification expert. Analyze these references for signs of AI hallucination (implausible authors, journals, years, or DOIs). Return ONLY valid JSON:
{
  "suspicious_citations": [{"citation":"string","reason":"string","risk":"HIGH"|"MEDIUM"|"LOW"}],
  "overall_risk": "LOW"|"MEDIUM"|"HIGH",
  "flagged_count": 0,
  "confidence": 0-100,
  "summary": "string"
}
Flag: author names that look generated, journals that don't exist, inconsistent years, suspiciously perfect formatting.`;
  try { return safeJson(await complete(sys, sanitize(references, 3000), { maxTokens: 700, taskType: 'citation' }), null); }
  catch (err) { logger.error({ err: err.message }, '[openrouter] citationHallucinationCheck failed'); return null; }
}

// ── NEW: Academic tone improver ───────────────────────────────────────────

async function toneImprove(text) {
  const sys = `You are an expert academic writing coach. Improve the text for academic publication while preserving the author's meaning. Return ONLY valid JSON:
{
  "improved_text": "string",
  "changes_made": ["string"],
  "tone_score_before": 0-100,
  "tone_score_after": 0-100,
  "readability_improvement": "string",
  "confidence": 0-100
}`;
  try { return safeJson(await complete(sys, sanitize(text, 2000), { maxTokens: 900, taskType: 'tone' }), null); }
  catch (err) { logger.error({ err: err.message }, '[openrouter] toneImprove failed'); return null; }
}

// ── NEW: Writing quality scorer ───────────────────────────────────────────

async function writingScore(text) {
  const sys = `You are an academic writing quality evaluator. Score the text on four dimensions and return ONLY valid JSON:
{
  "clarity": 0-100,
  "coherence": 0-100,
  "academic_vocabulary": 0-100,
  "structure": 0-100,
  "overall_grade": "A"|"B"|"C"|"D"|"F",
  "suggestions": ["string"],
  "strengths": ["string"],
  "confidence": 0-100
}`;
  try { return safeJson(await complete(sys, sanitize(text, 3000), { maxTokens: 600, taskType: 'analysis' }), null); }
  catch (err) { logger.error({ err: err.message }, '[openrouter] writingScore failed'); return null; }
}

// ── NEW: Section-by-section feedback ─────────────────────────────────────

async function sectionFeedback(sectionText, sectionType) {
  const sectionGuides = {
    introduction: 'Is the research gap clear? Is the contribution stated? Are key references cited?',
    methods: 'Is it reproducible? Are statistical methods justified? Is the sample described?',
    results: 'Are findings clearly presented? Do tables/figures add value? Are statistics reported correctly?',
    discussion: 'Are limitations acknowledged? Are conclusions supported by results? Is future work suggested?',
    abstract: 'Does it cover background, objective, methods, results, conclusion? Is it within word limits?',
  };
  const guide = sectionGuides[sectionType.toLowerCase()] || 'Evaluate the quality and completeness of this section.';
  const sys = `You are an expert academic reviewer evaluating the ${sectionType} section.
Key questions: ${guide}
Return ONLY valid JSON:
{
  "score": 0-100,
  "feedback": ["string"],
  "strengths": ["string"],
  "improvements": ["string"],
  "pass_fail": "PASS"|"WARN"|"FAIL",
  "confidence": 0-100
}`;
  try { return safeJson(await complete(sys, sanitize(sectionText, 3000), { maxTokens: 600, taskType: 'analysis' }), null); }
  catch (err) { logger.error({ err: err.message }, '[openrouter] sectionFeedback failed'); return null; }
}

// ── NEW: Review draft assistant ───────────────────────────────────────────

async function reviewAssist(roughNotes, paperTitle, paperAbstract) {
  const sys = `You are an expert peer reviewer. Take these rough reviewer notes and reformat them into a professional, constructive peer review. Maintain all criticisms but ensure the tone is respectful and actionable.
Return ONLY valid JSON:
{
  "formatted_review": "string",
  "summary": "string",
  "strengths": ["string"],
  "weaknesses": ["string"],
  "tone_score": 0-100,
  "completeness_score": 0-100,
  "flagged_phrases": ["unprofessional phrases that were softened"],
  "missing_sections": ["sections not covered in the notes"],
  "recommendation": "accept"|"minor_revisions"|"major_revisions"|"reject",
  "confidence": 0-100
}`;
  const user = 'Paper: "' + sanitize(paperTitle, 200) + '"\nAbstract: ' + sanitize(paperAbstract, 500) + '\n\nRough notes:\n' + sanitize(roughNotes, 2500);
  try { return safeJson(await complete(sys, user, { maxTokens: 1000, taskType: 'quality' }), null); }
  catch (err) { logger.error({ err: err.message }, '[openrouter] reviewAssist failed'); return null; }
}

// ── NEW: LLM-powered review quality check ─────────────────────────────────

async function reviewQualityLlm(review, paperTitle) {
  const sys = `You are an editorial quality assessor evaluating a peer review submission. Return ONLY valid JSON:
{
  "quality_score": 0-100,
  "is_substantive": true|false,
  "effort_level": "HIGH"|"MEDIUM"|"LOW",
  "tone_assessment": "professional"|"acceptable"|"unprofessional",
  "issues": ["string"],
  "strengths": ["string"],
  "recommendation": "acceptable"|"needs_improvement"|"insufficient",
  "confidence": 0-100
}`;
  const user = 'Paper: "' + sanitize(paperTitle, 200) + '"\nReview summary: ' + sanitize(review.summary, 500) + '\nStrengths: ' + sanitize(review.strengths, 500) + '\nWeaknesses: ' + sanitize(review.weaknesses, 500) + '\nRecommendation: ' + (review.recommendation || '');
  try { return safeJson(await complete(sys, user, { maxTokens: 500, taskType: 'quality' }), null); }
  catch (err) { logger.error({ err: err.message }, '[openrouter] reviewQualityLlm failed'); return null; }
}

// ── NEW: Author revision summarizer ──────────────────────────────────────

async function revisionSummarizer(paperTitle, reviewsText) {
  const sys = `You are an expert academic editor helping an author understand peer review feedback. Analyze the reviews and return ONLY valid JSON:
{
  "summary": "string",
  "themes": [{"theme":"string","reviewer_comments":["string"],"priority":"MUST"|"SHOULD"|"OPTIONAL"}],
  "revision_checklist": ["string"],
  "overall_revision_effort": "MINOR"|"MODERATE"|"MAJOR",
  "encouragement_note": "string",
  "confidence": 0-100
}`;
  const user = 'Paper: "' + sanitize(paperTitle, 200) + '"\n\nReviewer comments:\n' + sanitize(reviewsText, 3000);
  try { return safeJson(await complete(sys, user, { maxTokens: 900, taskType: 'summarization' }), null); }
  catch (err) { logger.error({ err: err.message }, '[openrouter] revisionSummarizer failed'); return null; }
}

// ── NEW: Response-to-reviewers assistant ─────────────────────────────────

async function responseToReviewers(paperTitle, reviewerComment) {
  const sys = `You are an expert academic author helping draft a point-by-point response to peer review. Return ONLY valid JSON:
{
  "draft_response": "string",
  "action_required": "REVISED"|"ADDRESSED_IN_TEXT"|"DISAGREE_WITH_REASONING",
  "tone_appropriate": true|false,
  "suggested_changes": ["string"],
  "confidence": 0-100
}`;
  const user = 'Paper: "' + sanitize(paperTitle, 200) + '"\nReviewer comment:\n' + sanitize(reviewerComment, 1500);
  try { return safeJson(await complete(sys, user, { maxTokens: 600, taskType: 'analysis' }), null); }
  catch (err) { logger.error({ err: err.message }, '[openrouter] responseToReviewers failed'); return null; }
}

// ── NEW: Analytics insights ───────────────────────────────────────────────

async function analyticsInsights(stats) {
  const sys = 'You are an academic journal analytics expert. Analyze these platform statistics. Return ONLY valid JSON with exactly these keys: {"insights":["string"],"key_findings":["string"],"action_items":["string"],"trend_summary":"string","confidence":85}. Maximum 4 items per array. Reference actual numbers.';
  try { return safeJson(await complete(sys, JSON.stringify(stats), { maxTokens: 500, taskType: 'analysis' }), null); }
  catch (err) { logger.error({ err: err.message }, '[openrouter] analyticsInsights failed'); return null; }
}

// ── NEW: Structured rubric generator ─────────────────────────────────────

async function generateRubric(paperType, domain, abstract) {
  const sys = 'You are a peer review coordinator. Generate a review rubric. Return ONLY valid JSON: {"rubric_title":"string","criteria":[{"criterion":"string","description":"string","weight":"string"}],"overall_guidance":"string","estimated_review_time_hours":3,"confidence":85}. Include 4-6 criteria.';
  const user = 'Paper type: ' + sanitize(paperType, 100) + '\nDomain: ' + sanitize(domain, 100) + '\nAbstract: ' + sanitize(abstract, 800);
  try { return safeJson(await complete(sys, user, { maxTokens: 700, taskType: 'analysis' }), null); }
  catch (err) { logger.error({ err: err.message }, '[openrouter] generateRubric failed'); return null; }
}

// ── Streaming support ─────────────────────────────────────────────────────

async function streamToneImprove(text, res) {
  const sys = 'You are an expert academic writing coach. Rewrite the following text with improved academic tone. Output only the improved text — no preamble, no JSON.';
  const primary = MODELS.tone;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  try {
    const streamRes = await callModel(primary, sys, sanitize(text, 2000), 800, true);
    const reader = streamRes.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const chunk = line.slice(6).trim();
        if (chunk === '[DONE]') { res.write('data: [DONE]\n\n'); break; }
        try {
          const parsed = JSON.parse(chunk);
          const delta = parsed.choices?.[0]?.delta?.content || '';
          if (delta) res.write('data: ' + JSON.stringify({ text: delta }) + '\n\n');
        } catch (_) {}
      }
    }
  } catch (err) {
    logger.error({ err: err.message }, '[openrouter] streamToneImprove failed');
    res.write('data: ' + JSON.stringify({ error: 'Stream failed' }) + '\n\n');
  }
  res.end();
}

module.exports = {
  complete,
  draftReview, summarize, extractKeywords, polishAbstract, suggestTitles,
  generateDecisionLetter, summarizeReviews,
  deskRejectionCheck, ethicsCheck, citationHallucinationCheck,
  toneImprove, writingScore, sectionFeedback,
  reviewAssist, reviewQualityLlm,
  revisionSummarizer, responseToReviewers,
  analyticsInsights, generateRubric,
  streamToneImprove,
};
