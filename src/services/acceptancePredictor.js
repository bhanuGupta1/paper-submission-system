'use strict';

/**
 * AI Acceptance Probability Predictor.
 *
 * Produces a confidence score (0-1) for acceptance/rejection/revisions
 * based on review scores, reviewer consensus, integrity signals, and
 * review sentiment.
 *
 * This is a decision-support tool for editors — never for automated decisions.
 * All inputs are from verified review data.
 */

const { all, get } = require('../db/connection');

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
}

/**
 * Predict acceptance probability for a paper.
 * @param {number} paperId
 * @returns {{ probability: number, prediction: string, confidence: string, factors: object, explanation: string[] }}
 */
async function predict(paperId) {
  const paper = await get('SELECT * FROM papers WHERE id = ?', [paperId]);
  if (!paper) throw new Error('Paper not found');

  const reviews = await all(
    'SELECT * FROM reviews WHERE paper_id = ? AND review_date IS NOT NULL AND declined_at IS NULL',
    [paperId]
  );

  if (reviews.length === 0) {
    return {
      probability: null,
      prediction: 'insufficient_data',
      confidence: 'none',
      factors: {},
      explanation: ['No completed reviews yet. Prediction requires at least one submitted review.'],
    };
  }

  const explanation = [];
  const factors = {};

  // Factor 1: Average review scores (weight: 40%)
  const noveltyScores = reviews.map((r) => r.novelty_score).filter(Boolean);
  const clarityScores = reviews.map((r) => r.clarity_score).filter(Boolean);
  const sigScores = reviews.map((r) => r.significance_score).filter(Boolean);

  const avgNovelty = avg(noveltyScores) || 3;
  const avgClarity = avg(clarityScores) || 3;
  const avgSig = avg(sigScores) || 3;
  const avgScore = (avgNovelty + avgClarity + avgSig) / 3;
  const normalizedScore = (avgScore - 1) / 4; // 1-5 → 0-1

  factors.avgScore = parseFloat(avgScore.toFixed(2));
  explanation.push(`Average review score: ${avgScore.toFixed(2)}/5.0 (novelty: ${avgNovelty.toFixed(1)}, clarity: ${avgClarity.toFixed(1)}, significance: ${avgSig.toFixed(1)})`);

  // Factor 2: Recommendation consensus (weight: 35%)
  const recMap = { accept: 1, minor_revisions: 0.7, major_revisions: 0.3, reject: 0 };
  const recScores = reviews.map((r) => recMap[r.recommendation] ?? 0.5);
  const avgRec = avg(recScores) || 0.5;
  factors.recommendationConsensus = parseFloat(avgRec.toFixed(2));

  const recCounts = reviews.reduce((acc, r) => { acc[r.recommendation] = (acc[r.recommendation] || 0) + 1; return acc; }, {});
  explanation.push(`Reviewer recommendations: ${Object.entries(recCounts).map(([k, v]) => `${k}: ${v}`).join(', ')}`);

  // Factor 3: Reviewer consensus (agreement between reviewers) (weight: 10%)
  let consensus = 1;
  if (reviews.length > 1) {
    const maxRec = Math.max(...Object.values(recCounts));
    consensus = maxRec / reviews.length;
  }
  factors.consensus = parseFloat(consensus.toFixed(2));
  if (reviews.length > 1) explanation.push(`Reviewer agreement: ${(consensus * 100).toFixed(0)}%`);

  // Factor 4: Integrity signals (weight: 15%)
  let integrityPenalty = 0;
  if (paper.similarity_score > 0.8) { integrityPenalty += 0.3; explanation.push('⚠ High similarity score — potential plagiarism concern'); }
  else if (paper.similarity_score > 0.5) { integrityPenalty += 0.1; explanation.push('⚠ Moderate similarity score flagged'); }
  if (paper.ai_text_likelihood > 0.8) { integrityPenalty += 0.2; explanation.push('⚠ High AI-text likelihood detected'); }
  else if (paper.ai_text_likelihood > 0.5) { integrityPenalty += 0.1; explanation.push('⚠ Moderate AI-text likelihood flagged'); }
  factors.integrityPenalty = parseFloat(integrityPenalty.toFixed(2));

  // Combine factors
  const rawScore = (normalizedScore * 0.40) + (avgRec * 0.35) + (consensus * 0.10) - (integrityPenalty * 0.15);
  const probability = Math.max(0, Math.min(1, sigmoid((rawScore - 0.5) * 6)));

  let prediction;
  if (probability >= 0.7) prediction = 'likely_accept';
  else if (probability >= 0.45) prediction = 'likely_revisions';
  else prediction = 'likely_reject';

  let confidence;
  if (reviews.length >= 3) confidence = 'high';
  else if (reviews.length === 2) confidence = 'medium';
  else confidence = 'low';

  return {
    probability: parseFloat(probability.toFixed(3)),
    prediction,
    confidence,
    factors,
    reviewCount: reviews.length,
    explanation,
  };
}

module.exports = { predict };
