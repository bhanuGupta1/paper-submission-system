'use strict';

/**
 * Plagiarism + AI-text heuristics.
 *
 * Two outputs:
 *
 *   similarity_score   - max cosine similarity (0..1) of the new paper
 *                        against every previously-submitted paper.
 *
 *   ai_text_likelihood - 0..1 heuristic that flags abstracts that *look*
 *                        AI-generated. We use simple stylometric signals
 *                        (sentence-length variance, hedging frequency,
 *                        uniform punctuation) - clearly imperfect, and
 *                        explicitly framed as a *flag for review*, never
 *                        a verdict. See the report for the ethical caveats.
 */

const Paper = require('../models/Paper');
const { buildModel, embed, cosine } = require('./embeddings');

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
    if (s > bestScore) {
      bestScore = s;
      bestIdx = i;
    }
  }
  return {
    score: Number(bestScore.toFixed(4)),
    mostSimilarId: bestIdx >= 0 ? all[bestIdx].id : null,
    mostSimilarTitle: bestIdx >= 0 ? all[bestIdx].title : null,
  };
}

/**
 * Heuristic AI-text signal. Returns a probability-like float and the
 * three sub-signals that fed into it so the UI can display reasoning.
 * Designed to be transparent and conservative - real detection is an
 * unsolved problem and we say so in the UI.
 */
function aiTextLikelihood(text) {
  if (!text || text.trim().length < 50) {
    return { score: 0, signals: { reason: 'too short to analyse' } };
  }
  const sents = text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z])/).filter(Boolean);

  // 1) Sentence length variance - LLM output tends to be more uniform.
  const lengths = sents.map((s) => s.split(' ').length);
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance = lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / lengths.length;
  const stdev = Math.sqrt(variance);
  const cv = mean > 0 ? stdev / mean : 0; // coefficient of variation
  const uniformity = Math.max(0, Math.min(1, 1 - cv * 1.5));

  // 2) Common LLM-favoured connectives.
  const llmPhrases = [
    'in conclusion','it is important to note','furthermore','moreover',
    'in summary','overall','additionally','it is worth noting','to summarize',
    'in this paper','in this study','as a result','consequently','notably',
  ];
  const lower = text.toLowerCase();
  const phraseHits = llmPhrases.filter((p) => lower.includes(p)).length;
  const phraseSignal = Math.min(1, phraseHits / 4);

  // 3) Hedging-vs-specifics ratio. LLM drafts often hedge.
  const hedges = (lower.match(/\b(may|might|could|possibly|likely|generally|often|various)\b/g) || []).length;
  const specifics = (lower.match(/\b(\d+(\.\d+)?%?|\d{4})\b/g) || []).length;
  const hedgeSignal = Math.min(1, hedges / Math.max(1, specifics + hedges));

  const score = Number(
    Math.min(
      1,
      0.45 * uniformity + 0.30 * phraseSignal + 0.25 * hedgeSignal
    ).toFixed(3)
  );

  return {
    score,
    signals: {
      sentence_uniformity: Number(uniformity.toFixed(3)),
      llm_phrase_hits: phraseHits,
      hedge_ratio: Number(hedgeSignal.toFixed(3)),
    },
  };
}

async function analyse(paper) {
  const sim = await similarityToCorpus(paper);
  const ai = aiTextLikelihood(`${paper.title}. ${paper.abstract}`);
  return {
    similarity_score: sim.score,
    most_similar_paper: sim.mostSimilarId
      ? { id: sim.mostSimilarId, title: sim.mostSimilarTitle }
      : null,
    ai_text_likelihood: ai.score,
    ai_text_signals: ai.signals,
  };
}

module.exports = { analyse, similarityToCorpus, aiTextLikelihood };
