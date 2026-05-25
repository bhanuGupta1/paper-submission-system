'use strict';

/**
 * Plagiarism + AI-text detection.
 *
 * similarity_score   - max TF-IDF cosine similarity against the existing corpus (0..1).
 *
 * ai_text_likelihood - 0..1 probability that the text is AI-generated.
 *   Primary:  LLM-based analysis via OpenRouter (context-aware, calibrated).
 *   Fallback: local stylometric heuristic (5 signals, always available).
 *
 * The score is a signal for editorial review, never a hard verdict.
 */

const Paper = require('../models/Paper');
const logger = require('../utils/logger');
const { buildModel, embed, cosine } = require('./embeddings');

// ── Corpus similarity (TF-IDF) ────────────────────────────────────────────

async function similarityToCorpus(paper) {
  const all = (await Paper.listAll()).filter((p) => p.id !== paper.id);
  if (all.length === 0) return { score: 0, mostSimilarId: null, mostSimilarTitle: null };

  const corpus = all.map((p) => `${p.title} ${p.abstract}`);
  const { vectors, idf } = buildModel(corpus);
  const target = embed(`${paper.title} ${paper.abstract}`, idf);

  let bestScore = 0;
  let bestIdx = -1;
  for (let i = 0; i < vectors.length; i++) {
    const s = cosine(target, vectors[i]);
    if (s > bestScore) { bestScore = s; bestIdx = i; }
  }
  return {
    score: Number(bestScore.toFixed(4)),
    mostSimilarId: bestIdx >= 0 ? all[bestIdx].id : null,
    mostSimilarTitle: bestIdx >= 0 ? all[bestIdx].title : null,
  };
}

// ── Heuristic AI-text signal (local fallback, 5 signals) ─────────────────

const LLM_PHRASES = [
  // Structural connectives
  'in conclusion','in summary','to summarize','overall,','furthermore,','moreover,',
  'additionally,','consequently,','as a result,','therefore,','thus,',
  // Hedging openers
  'it is important to note','it is worth noting','it should be noted',
  'it is essential to','notably,','importantly,',
  // Generic framing
  'in this paper','in this study','in this work','this paper presents',
  'this paper proposes','this study investigates','this work introduces',
  'we propose','we present','we introduce','we demonstrate',
  // LLM signoff patterns
  'in recent years,','over the past decade,','with the advent of',
  'has gained significant attention','has been widely studied',
  'plays a crucial role','plays an important role',
  'paves the way','sheds light on',
];

function aiTextLikelihoodHeuristic(text) {
  if (!text || text.trim().length < 60) {
    return { score: 0, method: 'heuristic', signals: { reason: 'too short' } };
  }

  const lower = text.toLowerCase();
  const sents = text
    .split(/(?<=[.!?])\s+(?=[A-Z"'])|(?<=[.!?])\n+/)
    .map(s => s.trim())
    .filter(s => s.length > 10);

  // 1) Sentence length uniformity — LLM output is suspiciously uniform
  const lengths = sents.map(s => s.split(/\s+/).length);
  const mean = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 20;
  const variance = lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, lengths.length);
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
  const uniformity = Math.max(0, Math.min(1, 1 - cv * 1.4));

  // 2) LLM-favoured phrase density
  const phraseHits = LLM_PHRASES.filter(p => lower.includes(p)).length;
  const phraseSignal = Math.min(1, phraseHits / 5);

  // 3) Hedge-to-specifics ratio — AI hedges more, cites fewer numbers
  const hedges = (lower.match(/\b(may|might|could|possibly|likely|generally|often|various|typically|frequently|commonly|widely)\b/g) || []).length;
  const specifics = (lower.match(/\b(\d[\d,]*(\.\d+)?%?|\d{4})\b/g) || []).length;
  const hedgeSignal = Math.min(1, hedges / Math.max(1, specifics + hedges));

  // 4) Vocabulary richness — AI uses wide but impersonal vocabulary
  const words = lower.match(/\b[a-z]{4,}\b/g) || [];
  const uniqueRatio = words.length ? new Set(words).size / words.length : 0;
  const vocabSignal = Math.max(0, Math.min(1, (uniqueRatio - 0.55) / 0.30));

  // 5) Average sentence length — AI drafts tend to write longer sentences
  const lengthSignal = Math.max(0, Math.min(1, (mean - 18) / 20));

  const score = Number(Math.min(1,
    0.30 * uniformity +
    0.25 * phraseSignal +
    0.20 * hedgeSignal +
    0.15 * vocabSignal +
    0.10 * lengthSignal
  ).toFixed(3));

  return {
    score,
    method: 'heuristic',
    signals: {
      sentence_uniformity: Number(uniformity.toFixed(3)),
      llm_phrase_hits: phraseHits,
      hedge_ratio: Number(hedgeSignal.toFixed(3)),
      vocabulary_richness: Number(uniqueRatio.toFixed(3)),
      avg_sentence_length: Number(mean.toFixed(1)),
    },
  };
}

// ── LLM-based AI-text detection (primary) ────────────────────────────────

async function aiTextLikelihoodLlm(text) {
  try {
    const llm = require('./llm');
    if (typeof llm.detectAiText !== 'function') return null;
    const result = await llm.detectAiText(text);
    if (!result || typeof result.ai_probability !== 'number') return null;
    return {
      score: Number(Math.max(0, Math.min(1, result.ai_probability)).toFixed(3)),
      method: 'llm',
      verdict: result.verdict || 'uncertain',
      signals: result.signals || [],
      confidence: result.confidence ?? 70,
    };
  } catch (err) {
    logger.warn({ err: err.message }, '[plagiarism] LLM AI detection failed, using heuristic');
    return null;
  }
}

// ── Combined analysis ─────────────────────────────────────────────────────

async function analyse(paper) {
  const text = [paper.title, paper.abstract].filter(Boolean).join('. ');

  const [simResult, llmResult] = await Promise.allSettled([
    similarityToCorpus(paper),
    aiTextLikelihoodLlm(text),
  ]);

  const sim = simResult.status === 'fulfilled'
    ? simResult.value
    : { score: 0, mostSimilarId: null, mostSimilarTitle: null };

  const aiResult = (llmResult.status === 'fulfilled' && llmResult.value)
    ? llmResult.value
    : aiTextLikelihoodHeuristic(text);

  logger.info({ paperId: paper.id, method: aiResult.method, score: aiResult.score }, '[plagiarism] AI detection complete');

  return {
    similarity_score: sim.score,
    most_similar_paper: sim.mostSimilarId ? { id: sim.mostSimilarId, title: sim.mostSimilarTitle } : null,
    ai_text_likelihood: aiResult.score,
    ai_text_signals: aiResult.signals,
    ai_detection_method: aiResult.method,
    ai_verdict: aiResult.verdict || null,
  };
}

module.exports = { analyse, similarityToCorpus, aiTextLikelihoodHeuristic, aiTextLikelihoodLlm };
