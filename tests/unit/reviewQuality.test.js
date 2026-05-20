'use strict';

const { assessReview } = require('../../src/services/reviewQuality');

const GOOD_REVIEW = {
  summary: 'This paper introduces a novel approach to transformer-based sequence modelling that addresses the quadratic complexity of standard self-attention. The authors benchmark against six competitive baselines and report consistent improvements across three NLP tasks.',
  strengths: 'Strong empirical results with statistically significant improvements. Code is publicly released. The ablation study clearly isolates the contribution of each proposed component. Writing is clear and well-structured.',
  weaknesses: 'The theoretical analysis in Section 4 is informal. Scalability beyond the reported sequence lengths is not demonstrated. Comparison with efficient attention variants like Linformer or Performer is missing.',
  review_text: 'The paper makes a solid technical contribution but would benefit from a broader comparison set.',
  novelty_score: 4,
  clarity_score: 4,
  significance_score: 3,
};

const PAPER = {
  abstract: 'We propose a new method for efficient sequence modelling using sparse attention patterns. We evaluate on benchmarks and show improvements.',
};

describe('reviewQuality.assessReview', () => {
  test('high-quality review scores >= 80 and is acceptable', () => {
    const result = assessReview(GOOD_REVIEW, PAPER);
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.recommendation).toBe('acceptable');
    expect(result.issues).toHaveLength(0);
  });

  test('empty review is heavily penalised and needs_improvement or insufficient', () => {
    const empty = { summary: '', strengths: '', weaknesses: '', review_text: '', novelty_score: 3, clarity_score: 3, significance_score: 3 };
    const result = assessReview(empty, PAPER);
    expect(result.score).toBeLessThan(60);
    expect(['needs_improvement', 'insufficient']).toContain(result.recommendation);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  test('very short review is flagged as brief', () => {
    const short = { ...GOOD_REVIEW, summary: 'OK paper.', strengths: 'Good.', weaknesses: 'Bad.', review_text: '' };
    const result = assessReview(short, PAPER);
    expect(result.issues.some(i => /short|brief/i.test(i))).toBe(true);
    expect(result.score).toBeLessThan(80);
  });

  test('hostile language reduces score and flags negative_bias', () => {
    const hostile = { ...GOOD_REVIEW, weaknesses: 'This is terrible and horrible research. Garbage ideas.' };
    const result = assessReview(hostile, PAPER);
    expect(result.flags).toContain('negative_bias');
    expect(result.score).toBeLessThan(assessReview(GOOD_REVIEW, PAPER).score);
  });

  test('uniform extreme scores are flagged', () => {
    const uniform = { ...GOOD_REVIEW, novelty_score: 5, clarity_score: 5, significance_score: 5 };
    const result = assessReview(uniform, PAPER);
    expect(result.flags).toContain('uniform_scores');
  });

  test('vague phrases are detected and penalised', () => {
    const vague = { ...GOOD_REVIEW, weaknesses: 'This is not good enough. Needs work. Start over.' };
    const result = assessReview(vague, PAPER);
    expect(result.issues.some(i => /vague/i.test(i))).toBe(true);
  });

  test('wordCount is returned correctly', () => {
    const result = assessReview(GOOD_REVIEW, PAPER);
    expect(result.wordCount).toBeGreaterThan(50);
  });

  test('works without paper abstract (no crash)', () => {
    const result = assessReview(GOOD_REVIEW, {});
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('recommendation');
  });
});
