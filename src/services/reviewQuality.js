'use strict';

/**
 * AI Review Quality Checker.
 *
 * Flags low-effort, biased, or superficial reviews.
 * Returns a quality score (0-100) + issues list + recommendation.
 * Has zero external dependencies — pure JS heuristics.
 */

const STOPWORDS = new Set(['the','a','an','and','or','but','of','in','on','at','to','for','with','by','from','as','is','are','was','were','be','been','this','that','it','its','we','our','they','also','very','more','most','some','any','all','not','no','so','if','about','into']);

function tokenize(t) {
  return String(t || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function wordCount(t) {
  return String(t || '').trim().split(/\s+/).filter(Boolean).length;
}

function sentenceCount(t) {
  return (String(t || '').match(/[.!?]+/g) || []).length;
}

function uniqueWordRatio(t) {
  const tokens = tokenize(t);
  if (!tokens.length) return 0;
  return new Set(tokens).size / tokens.length;
}

// Detects copy-paste of paper text into review (high overlap indicates lazy review)
function overlapWithPaper(reviewText, paperAbstract) {
  const reviewTokens = new Set(tokenize(reviewText));
  const paperTokens = new Set(tokenize(paperAbstract));
  if (!reviewTokens.size || !paperTokens.size) return 0;
  let overlap = 0;
  for (const t of reviewTokens) { if (paperTokens.has(t)) overlap++; }
  return overlap / reviewTokens.size;
}

const BIAS_POSITIVE = ['excellent', 'outstanding', 'perfect', 'flawless', 'genius', 'groundbreaking', 'revolutionar'];
const BIAS_NEGATIVE = ['terrible', 'awful', 'horrible', 'useless', 'worthless', 'garbage', 'idiotic', 'nonsense'];
const VAGUE_PHRASES = ['not good enough', 'needs improvement', 'needs work', 'this is wrong', 'this is bad', 'rewrite', 'start over', 'poor quality'];

function detectBias(text) {
  const lower = text.toLowerCase();
  const positive = BIAS_POSITIVE.filter((w) => lower.includes(w));
  const negative = BIAS_NEGATIVE.filter((w) => lower.includes(w));
  return { positiveBias: positive, negativeBias: negative };
}

function detectVaguePhrases(text) {
  const lower = text.toLowerCase();
  return VAGUE_PHRASES.filter((p) => lower.includes(p));
}

/**
 * Assess the quality of a submitted review.
 * @param {object} review - review record from DB
 * @param {object} paper - paper record from DB
 * @returns {{ score: number, issues: string[], flags: string[], recommendation: string }}
 */
function assessReview(review, paper) {
  const issues = [];
  const flags = [];
  let score = 100;

  const summaryWc = wordCount(review.summary);
  const strengthsWc = wordCount(review.strengths);
  const weaknessesWc = wordCount(review.weaknesses);
  const fullTextWc = wordCount(review.review_text);
  const totalWc = summaryWc + strengthsWc + weaknessesWc + fullTextWc;

  // Length checks
  if (totalWc < 50) { issues.push('Review is very short (< 50 words total). Substantial feedback is expected.'); score -= 30; }
  else if (totalWc < 100) { issues.push('Review is brief (< 100 words). More detailed feedback is recommended.'); score -= 15; }

  if (summaryWc < 20) { issues.push('Summary section is very short. A meaningful summary of the paper should be provided.'); score -= 10; }
  if (weaknessesWc < 15) { issues.push('Weaknesses section is sparse. Specific constructive criticism is required.'); score -= 10; }

  // Vocabulary diversity
  const fullText = `${review.summary} ${review.strengths} ${review.weaknesses} ${review.review_text}`;
  const uur = uniqueWordRatio(fullText);
  if (uur < 0.4 && totalWc > 30) { issues.push('Low vocabulary diversity — may indicate copy-pasted or repetitive content.'); score -= 10; }

  // Paper overlap
  if (paper && paper.abstract) {
    const overlap = overlapWithPaper(fullText, paper.abstract);
    if (overlap > 0.6) { issues.push('High overlap with paper abstract — review may be paraphrasing the paper rather than critiquing it.'); score -= 20; flags.push('high_paper_overlap'); }
  }

  // Bias detection
  const { positiveBias, negativeBias } = detectBias(fullText);
  if (positiveBias.length > 0) { flags.push('positive_bias'); issues.push(`Potentially over-positive language: ${positiveBias.join(', ')}`); score -= 5; }
  if (negativeBias.length > 0) { flags.push('negative_bias'); issues.push(`Potentially hostile language: ${negativeBias.join(', ')}`); score -= 15; }

  // Vague phrases
  const vagueFound = detectVaguePhrases(fullText);
  if (vagueFound.length > 0) { issues.push(`Vague/unhelpful phrases detected: "${vagueFound.join('", "')}". Replace with specific, actionable feedback.`); score -= 10; }

  // Sentence variety
  const numSentences = sentenceCount(fullText);
  if (numSentences < 3 && totalWc > 20) { issues.push('Review has very few sentences. Consider expanding with more detailed analysis.'); score -= 5; }

  // Score reasonableness (if all scores are same value, could indicate random clicking)
  const scores = [review.novelty_score, review.clarity_score, review.significance_score].filter((s) => s != null);
  if (scores.length === 3 && scores[0] === scores[1] && scores[1] === scores[2]) {
    flags.push('uniform_scores');
    if (scores[0] === 1 || scores[0] === 5) issues.push('All scores are identical and extreme — please review each dimension independently.');
    else issues.push('All scores are identical — please evaluate novelty, clarity, and significance separately.');
    score -= 5;
  }

  score = Math.max(0, Math.min(100, score));

  let recommendation;
  if (score >= 80) recommendation = 'acceptable';
  else if (score >= 50) recommendation = 'needs_improvement';
  else recommendation = 'insufficient';

  return { score, issues, flags, recommendation, wordCount: totalWc };
}

module.exports = { assessReview };
