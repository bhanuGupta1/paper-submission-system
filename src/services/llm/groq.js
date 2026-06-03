'use strict';

/**
 * Groq backend — OpenAI-compatible chat completions on Groq's LPU cloud.
 *
 * Activates when LLM_PROVIDER=groq (or auto-detected when GROQ_API_KEY is set)
 * AND GROQ_API_KEY is non-empty. Exposes the SAME interface as openrouter.js so
 * every call site keeps working when Groq is the default provider; every method
 * degrades to the offline heuristic backend on error.
 *
 * Reliability features:
 *   - Native JSON mode (response_format: json_object) for structured calls,
 *     so we parse a contract instead of regex-scraping prose.
 *   - Per-request hard timeout via AbortController (config.llm.groq.timeoutMs).
 *   - Task-specific model routing + a fallback chain across models.
 *   - 429 Retry-After handling and 4xx/5xx -> next-model fallback.
 */

const config = require('../../config');
const logger = require('../../utils/logger');
const heuristic = require('./heuristic');

const API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const API_KEY = config.llm.groq.apiKey;
const TIMEOUT_MS = config.llm.groq.timeoutMs || 30000;

// Task-specific models. 70b-versatile for reasoning-heavy work, 8b-instant for
// cheap/fast summarisation. Any unavailable model just falls through the chain.
const MODELS = {
  analysis:      'llama-3.3-70b-versatile',
  summarization: 'llama-3.1-8b-instant',
  similarity:    'llama-3.1-8b-instant',
  matching:      'llama-3.3-70b-versatile',
  quality:       'llama-3.3-70b-versatile',
  citation:      'llama-3.3-70b-versatile',
  tone:          'llama-3.3-70b-versatile',
  decision:      'llama-3.3-70b-versatile',
  default:       config.llm.groq.model || 'llama-3.3-70b-versatile',
};

// Ordered by capability; a wrong/decommissioned name (Groq returns 400/404)
// is skipped automatically, and the offline heuristic is the final safety net.
// Verified against https://console.groq.com/docs/models (June 2026).
const FALLBACK_MODELS = [
  'llama-3.3-70b-versatile',     // production, reliable JSON mode
  'openai/gpt-oss-120b',         // production, flagship open-weight reasoning
  'openai/gpt-oss-20b',          // production, very fast (~1000 t/s)
  'llama-3.1-8b-instant',        // production, fast + low cost
  'qwen/qwen3-32b',              // preview, capable extra fallback
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function callModel(model, systemPrompt, userPrompt, maxTokens, { stream = false, json = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: 0.4,
        stream,
        // Groq JSON mode requires the literal word "JSON" in the prompt (all
        // structured prompts include it) and a non-streaming request.
        ...(json && !stream ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => res.statusText);
      const err = new Error('Groq ' + res.status + ': ' + txt);
      err.status = res.status;
      err.retryAfter = res.headers.get('retry-after');
      throw err;
    }
    if (stream) { clearTimeout(timer); return res; } // caller drains the stream
    const data = await res.json();
    if (!data.choices || !data.choices[0]) throw new Error('No choices in response');
    return (data.choices[0].message.content || '').trim();
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error('Groq request timed out after ' + TIMEOUT_MS + 'ms');
      e.status = 408;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function complete(systemPrompt, userPrompt, { maxTokens = 800, taskType = 'default', json = false } = {}) {
  const primary = MODELS[taskType] || MODELS.default;
  const chain = [primary, ...FALLBACK_MODELS.filter(m => m !== primary)];
  let lastErr;
  let delay = 0;
  for (const model of chain) {
    if (delay > 0) await sleep(delay);
    delay = 0;
    try {
      const result = await callModel(model, systemPrompt, userPrompt, maxTokens, { json });
      if (model !== primary) logger.info({ model, taskType }, '[groq] fallback model used');
      return result;
    } catch (err) {
      lastErr = err;
      if (err.status === 429) {
        const ra = Math.ceil(parseFloat(err.retryAfter));
        delay = Math.min((Number.isNaN(ra) ? 4 : ra) * 1000, 8000); // cap at 8s
        logger.warn({ model, taskType, delayMs: delay }, '[groq] 429 rate-limited, waiting before next fallback');
        continue;
      }
      // 400 = decommissioned/unknown model, 404 = not found, 408 = our timeout,
      // 5xx = transient upstream — in all cases try the next model in the chain.
      if ([400, 404, 408, 500, 502, 503].includes(err.status)) {
        logger.warn({ model, taskType, status: err.status }, '[groq] model unavailable/timeout, trying next');
        delay = 800;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// ── Core author tools (parity with heuristic + openrouter) ─────────────────

async function draftReview(paper) {
  const sys = 'You are an expert academic peer reviewer. Output ONLY valid JSON: {"summary":"string","strengths":["string"],"weaknesses":["string"],"novelty_score":1,"clarity_score":1,"significance_score":1,"recommendation":"accept|reject|revisions","confidence":85}';
  const user = 'Title: ' + sanitize(paper.title, 200) + '\nAbstract: ' + sanitize(paper.abstract, 2000) + '\nKeywords: ' + sanitize(paper.keywords, 200);
  try { const raw = await complete(sys, user, { maxTokens: 700, taskType: 'analysis', json: true }); return safeJson(raw, heuristic.draftReview(paper)); }
  catch (err) { logger.error({ err: err.message }, '[groq] draftReview failed'); return heuristic.draftReview(paper); }
}

async function summarize(text, n = 3) {
  if (!text || text.length < 100) return heuristic.summarize(text, n);
  try { return await complete('Summarize in ' + n + ' sentences. Output only the summary.', sanitize(text, 4000), { maxTokens: 300, taskType: 'summarization' }); }
  catch (err) { logger.error({ err: err.message }, '[groq] summarize failed'); return heuristic.summarize(text, n); }
}

async function extractKeywords(text, n = 8) {
  if (!text) return heuristic.extractKeywords(text, n);
  try {
    const raw = await complete('Extract ' + n + ' academic keywords. Output ONLY a JSON array of strings.', sanitize(text, 3000), { maxTokens: 150, taskType: 'analysis' });
    const arr = JSON.parse((raw.match(/\[[\s\S]*\]/) || ['[]'])[0]);
    return Array.isArray(arr) && arr.length ? arr.slice(0, n) : heuristic.extractKeywords(text, n);
  } catch (err) { logger.error({ err: err.message }, '[groq] extractKeywords failed'); return heuristic.extractKeywords(text, n); }
}

async function polishAbstract(text) {
  if (!text) return heuristic.polishAbstract(text);
  const sys = 'Polish this academic abstract. Return ONLY JSON: {"revised":"string","suggestions":["string"],"confidence":80}';
  try { const raw = await complete(sys, sanitize(text, 2000), { maxTokens: 600, taskType: 'analysis', json: true }); return safeJson(raw, heuristic.polishAbstract(text)); }
  catch (err) { logger.error({ err: err.message }, '[groq] polishAbstract failed'); return heuristic.polishAbstract(text); }
}

async function suggestTitles(abstract) {
  if (!abstract) return heuristic.suggestTitles(abstract);
  try {
    const raw = await complete('Suggest 5 academic paper titles. Output ONLY a JSON array of strings.', sanitize(abstract, 1500), { maxTokens: 200, taskType: 'analysis' });
    const arr = JSON.parse((raw.match(/\[[\s\S]*\]/) || ['[]'])[0]);
    return Array.isArray(arr) && arr.length ? arr.slice(0, 5) : heuristic.suggestTitles(abstract);
  } catch (err) { logger.error({ err: err.message }, '[groq] suggestTitles failed'); return heuristic.suggestTitles(abstract); }
}

// ── Manuscript metadata extraction (auto-fill the submission form) ─────────
// Reads the start of an uploaded manuscript and returns title/authors/abstract/
// keywords/tags so the submit form can pre-populate. Degrades to the offline
// heuristic extractor on any error or empty input.
async function extractMetadata(fullText) {
  const body = String(fullText || '').trim();
  if (!body) return heuristic.extractMetadata(body);
  const sys = `You extract bibliographic metadata from the BEGINNING of an academic manuscript.
Use ONLY information present in the text; never invent authors, titles, or results. If a field is absent, return an empty string or empty array.
Return ONLY valid JSON:
{
  "title": "string",
  "authors": ["First Last"],
  "abstract": "string (verbatim or lightly cleaned)",
  "keywords": ["string"],
  "tags": ["string (3-6 short topical tags you infer)"],
  "confidence": 0-100
}`;
  try {
    const raw = await complete(sys, sanitize(body, 6000), { maxTokens: 900, taskType: 'analysis', json: true });
    return safeJson(raw, null) || heuristic.extractMetadata(body);
  } catch (err) {
    logger.error({ err: err.message }, '[groq] extractMetadata failed');
    return heuristic.extractMetadata(body);
  }
}

async function generateDecisionLetter(paper, reviews, suggestion, explanation) {
  const revText = reviews.slice(0, 5).map((r, i) => 'Reviewer ' + (i+1) + ' (' + r.recommendation + '): ' + [r.summary, r.strengths ? 'Strengths: '+r.strengths : '', r.weaknesses ? 'Weaknesses: '+r.weaknesses : ''].filter(Boolean).join('. ')).join('\n---\n');
  const sys = 'You are an academic journal editor. Write a professional editorial decision letter body (2-4 paragraphs, no salutation or signature). Be specific and constructive.';
  const user = 'Paper: "' + sanitize(paper.title, 200) + '"\nDecision: ' + suggestion + '\nContext: ' + (explanation||[]).join(' ') + '\n\nReviewer feedback:\n' + sanitize(revText, 2000);
  try { return await complete(sys, user, { maxTokens: 600, taskType: 'decision' }); }
  catch (err) { logger.error({ err: err.message }, '[groq] generateDecisionLetter failed'); return null; }
}

async function summarizeReviews(paper, reviews) {
  if (!reviews || !reviews.length) return null;
  const revText = reviews.slice(0, 6).map((r, i) => 'Reviewer ' + (i+1) + ' (' + r.recommendation + '): ' + [r.summary, r.strengths ? 'Strengths: '+r.strengths : '', r.weaknesses ? 'Weaknesses: '+r.weaknesses : ''].filter(Boolean).join('. ')).join('\n---\n');
  const sys = 'Summarize peer review consensus and disagreements in 3-5 sentences.';
  const user = 'Paper: "' + sanitize(paper.title, 200) + '"\n\nReviews:\n' + sanitize(revText, 3000);
  try { return await complete(sys, user, { maxTokens: 350, taskType: 'summarization' }); }
  catch (err) { logger.error({ err: err.message }, '[groq] summarizeReviews failed'); return null; }
}

// ── Pre-submission desk rejection check ────────────────────────────────────

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
  try { return safeJson(await complete(sys, user, { maxTokens: 700, taskType: 'analysis', json: true }), null); }
  catch (err) { logger.error({ err: err.message }, '[groq] deskRejectionCheck failed'); return null; }
}

// ── Ethics & compliance checker ────────────────────────────────────────────

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
  try { return safeJson(await complete(sys, combined, { maxTokens: 600, taskType: 'analysis', json: true }), null); }
  catch (err) { logger.error({ err: err.message }, '[groq] ethicsCheck failed'); return null; }
}

// ── Citation hallucination detector ────────────────────────────────────────

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
  try { return safeJson(await complete(sys, sanitize(references, 3000), { maxTokens: 700, taskType: 'citation', json: true }), null); }
  catch (err) { logger.error({ err: err.message }, '[groq] citationHallucinationCheck failed'); return null; }
}

// ── Academic tone improver ─────────────────────────────────────────────────

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
  try { return safeJson(await complete(sys, sanitize(text, 2000), { maxTokens: 900, taskType: 'tone', json: true }), null); }
  catch (err) { logger.error({ err: err.message }, '[groq] toneImprove failed'); return null; }
}

// ── Writing quality scorer ─────────────────────────────────────────────────

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
  try { return safeJson(await complete(sys, sanitize(text, 3000), { maxTokens: 600, taskType: 'analysis', json: true }), null); }
  catch (err) { logger.error({ err: err.message }, '[groq] writingScore failed'); return null; }
}

// ── Section-by-section feedback ────────────────────────────────────────────

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
  try { return safeJson(await complete(sys, sanitize(sectionText, 3000), { maxTokens: 600, taskType: 'analysis', json: true }), null); }
  catch (err) { logger.error({ err: err.message }, '[groq] sectionFeedback failed'); return null; }
}

// ── Review draft assistant ─────────────────────────────────────────────────

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
  try { return safeJson(await complete(sys, user, { maxTokens: 1000, taskType: 'quality', json: true }), null); }
  catch (err) { logger.error({ err: err.message }, '[groq] reviewAssist failed'); return null; }
}

// ── LLM-powered review quality check ───────────────────────────────────────

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
  try { return safeJson(await complete(sys, user, { maxTokens: 500, taskType: 'quality', json: true }), null); }
  catch (err) { logger.error({ err: err.message }, '[groq] reviewQualityLlm failed'); return null; }
}

// ── Author revision summarizer ─────────────────────────────────────────────

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
  try { return safeJson(await complete(sys, user, { maxTokens: 900, taskType: 'summarization', json: true }), null); }
  catch (err) { logger.error({ err: err.message }, '[groq] revisionSummarizer failed'); return null; }
}

// ── Response-to-reviewers assistant ────────────────────────────────────────

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
  try { return safeJson(await complete(sys, user, { maxTokens: 600, taskType: 'analysis', json: true }), null); }
  catch (err) { logger.error({ err: err.message }, '[groq] responseToReviewers failed'); return null; }
}

// ── Analytics insights ─────────────────────────────────────────────────────

async function analyticsInsights(stats) {
  const sys = 'You are an academic journal analytics expert. Analyze these platform statistics. Return ONLY valid JSON with exactly these keys: {"insights":["string"],"key_findings":["string"],"action_items":["string"],"trend_summary":"string","confidence":85}. Maximum 4 items per array. Reference actual numbers.';
  try { return safeJson(await complete(sys, JSON.stringify(stats), { maxTokens: 700, taskType: 'analysis', json: true }), null); }
  catch (err) { logger.error({ err: err.message }, '[groq] analyticsInsights failed'); return null; }
}

// ── Structured rubric generator ────────────────────────────────────────────

async function generateRubric(paperType, domain, abstract) {
  const sys = 'You are a peer review coordinator. Generate a review rubric. Return ONLY valid JSON: {"rubric_title":"string","criteria":[{"criterion":"string","description":"string","weight":"string"}],"overall_guidance":"string","estimated_review_time_hours":3,"confidence":85}. Include 4-6 criteria.';
  const user = 'Paper type: ' + sanitize(paperType, 100) + '\nDomain: ' + sanitize(domain, 100) + '\nAbstract: ' + sanitize(abstract, 800);
  try { return safeJson(await complete(sys, user, { maxTokens: 700, taskType: 'analysis', json: true }), null); }
  catch (err) { logger.error({ err: err.message }, '[groq] generateRubric failed'); return null; }
}

// ── AI-generated text detector ─────────────────────────────────────────────

async function detectAiText(text) {
  const sys = `You are an expert forensic linguist specialising in detecting AI-generated academic text.
Analyse the provided text for signals of AI authorship and return ONLY valid JSON:
{
  "ai_probability": 0.0,
  "verdict": "human"|"likely_human"|"uncertain"|"likely_ai"|"ai",
  "signals": ["string"],
  "confidence": 0-100
}
Calibration rules:
- Score 0.0-0.25 = human/likely_human: distinct personal voice, irregular sentence rhythm, idiosyncratic phrasing, field-specific jargon used naturally.
- Score 0.25-0.55 = uncertain: mixed signals, possibly AI-assisted editing of human text.
- Score 0.55-0.75 = likely_ai: uniform rhythm, heavy use of transition phrases, hedging without specifics, overly balanced structure.
- Score 0.75-1.0 = ai: strong uniformity, multiple LLM-favoured connectives, suspiciously polished grammar, lack of concrete detail.
List up to 5 specific signals observed. Be conservative — most academic writing has some AI-like features.`;
  try {
    return safeJson(await complete(sys, sanitize(text, 3000), { maxTokens: 350, taskType: 'analysis', json: true }), null);
  } catch (err) {
    logger.error({ err: err.message }, '[groq] detectAiText failed');
    return null;
  }
}

// ── NEW (v3): Plain-language summary ───────────────────────────────────────
// Rewrites the abstract for a non-specialist audience and explains jargon.

async function plainLanguageSummary(title, abstract) {
  if (!abstract || !abstract.trim()) return null;
  const sys = `You are a science communicator. Rewrite the academic work for an educated non-specialist (a curious undergraduate). Preserve accuracy; do NOT invent results. Return ONLY valid JSON:
{
  "plain_summary": "string (2-4 short sentences, no jargon)",
  "key_terms_explained": [{"term":"string","explanation":"string"}],
  "why_it_matters": "string",
  "target_reading_level": "string",
  "confidence": 0-100
}`;
  const user = 'Title: ' + sanitize(title, 200) + '\nAbstract: ' + sanitize(abstract, 2500);
  try { return safeJson(await complete(sys, user, { maxTokens: 700, taskType: 'summarization', json: true }), null); }
  catch (err) { logger.error({ err: err.message }, '[groq] plainLanguageSummary failed'); return null; }
}

// ── NEW (v3): Key contributions extractor ──────────────────────────────────
// Pulls the explicit claims/contributions so editors can assess novelty fast.

async function keyContributions(title, abstract) {
  if (!abstract || !abstract.trim()) return null;
  const sys = `You are a senior reviewer extracting a paper's core contributions. Only list contributions grounded in the supplied text; do NOT fabricate. Return ONLY valid JSON:
{
  "contributions": [{"contribution":"string","type":"theoretical"|"empirical"|"methodological"|"applied","grounded_in_text":true|false}],
  "novelty_assessment": "string",
  "novelty_score": 0-100,
  "confidence": 0-100
}`;
  const user = 'Title: ' + sanitize(title, 200) + '\nAbstract: ' + sanitize(abstract, 2500);
  try { return safeJson(await complete(sys, user, { maxTokens: 700, taskType: 'analysis', json: true }), null); }
  catch (err) { logger.error({ err: err.message }, '[groq] keyContributions failed'); return null; }
}

// ── NEW (v3): Title ↔ abstract consistency check ───────────────────────────
// Flags titles that over-claim or under-represent the abstract's content.

async function titleAbstractConsistency(title, abstract) {
  if (!title || !abstract) return null;
  const sys = `You are an editorial consistency checker. Judge whether the title accurately reflects the abstract — flag over-claiming, scope mismatch, or missing key topics. Return ONLY valid JSON:
{
  "consistency_score": 0-100,
  "aligned": true|false,
  "mismatches": ["string"],
  "missing_from_title": ["string"],
  "overclaims": ["string"],
  "suggested_titles": ["string"],
  "confidence": 0-100
}`;
  const user = 'Title: ' + sanitize(title, 200) + '\nAbstract: ' + sanitize(abstract, 2500);
  try { return safeJson(await complete(sys, user, { maxTokens: 600, taskType: 'analysis', json: true }), null); }
  catch (err) { logger.error({ err: err.message }, '[groq] titleAbstractConsistency failed'); return null; }
}

// ── NEW (v3): Limitations finder ───────────────────────────────────────────
// Surfaces stated limitations and likely unstated ones for reviewer prompts.

async function limitationsFinder(title, abstract, fullText) {
  const body = (fullText || abstract || '').trim();
  if (!body) return null;
  const sys = `You are a critical peer reviewer identifying study limitations. Separate limitations the authors STATE from ones they likely OMIT. Be specific and fair; do NOT fabricate findings. Return ONLY valid JSON:
{
  "stated_limitations": ["string"],
  "potential_unstated_limitations": ["string"],
  "severity": "LOW"|"MEDIUM"|"HIGH",
  "reviewer_questions": ["string"],
  "suggestions": ["string"],
  "confidence": 0-100
}`;
  const user = 'Title: ' + sanitize(title, 200) + '\n\n' + sanitize(body, 3000);
  try { return safeJson(await complete(sys, user, { maxTokens: 700, taskType: 'quality', json: true }), null); }
  catch (err) { logger.error({ err: err.message }, '[groq] limitationsFinder failed'); return null; }
}

// ── Streaming support (plain text, no JSON mode) ───────────────────────────

async function streamToneImprove(text, res) {
  const sys = 'You are an expert academic writing coach. Rewrite the following text with improved academic tone. Output only the improved text — no preamble, no JSON.';
  const primary = MODELS.tone;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  try {
    const streamRes = await callModel(primary, sys, sanitize(text, 2000), 800, { stream: true });
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
    logger.error({ err: err.message }, '[groq] streamToneImprove failed');
    res.write('data: ' + JSON.stringify({ error: 'Stream failed' }) + '\n\n');
  }
  res.end();
}

module.exports = {
  complete,
  draftReview, summarize, extractKeywords, polishAbstract, suggestTitles,
  extractMetadata,
  generateDecisionLetter, summarizeReviews,
  deskRejectionCheck, ethicsCheck, citationHallucinationCheck,
  toneImprove, writingScore, sectionFeedback,
  reviewAssist, reviewQualityLlm,
  revisionSummarizer, responseToReviewers,
  analyticsInsights, generateRubric,
  detectAiText,
  plainLanguageSummary, keyContributions, titleAbstractConsistency, limitationsFinder,
  streamToneImprove,
};
