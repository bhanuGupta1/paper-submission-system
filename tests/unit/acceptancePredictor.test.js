'use strict';

jest.mock('../../src/db/connection', () => ({
  get: jest.fn(),
  all: jest.fn(),
  run: jest.fn(),
}));

const { get, all } = require('../../src/db/connection');
const predictor = require('../../src/services/acceptancePredictor');

const PAPER = {
  id: 1,
  title: 'Test paper',
  abstract: 'Novel contribution with solid evaluation and code release.',
  tags: 'NLP, ML',
  ai_keywords: 'transformer, attention',
  similarity_score: 0.1,
  ai_text_likelihood: 0.2,
};

const GOOD_REVIEWS = [
  { review_date: new Date().toISOString(), declined_at: null, recommendation: 'accept', novelty_score: 5, clarity_score: 4, significance_score: 5 },
  { review_date: new Date().toISOString(), declined_at: null, recommendation: 'accept', novelty_score: 4, clarity_score: 4, significance_score: 4 },
];

const BAD_REVIEWS = [
  { review_date: new Date().toISOString(), declined_at: null, recommendation: 'reject', novelty_score: 1, clarity_score: 2, significance_score: 1 },
  { review_date: new Date().toISOString(), declined_at: null, recommendation: 'reject', novelty_score: 2, clarity_score: 1, significance_score: 2 },
];

describe('acceptancePredictor.predict', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns insufficient_data with null probability when no reviews', async () => {
    get.mockResolvedValue(PAPER);
    all.mockResolvedValue([]);

    const result = await predictor.predict(1);
    expect(result.probability).toBeNull();
    expect(result.prediction).toBe('insufficient_data');
    expect(result.confidence).toBe('none');
    expect(Array.isArray(result.explanation)).toBe(true);
  });

  test('with good reviews returns valid probability and likely_accept', async () => {
    get.mockResolvedValue(PAPER);
    all.mockResolvedValue(GOOD_REVIEWS);

    const result = await predictor.predict(1);
    expect(result.probability).toBeGreaterThan(0);
    expect(result.probability).toBeLessThanOrEqual(1);
    expect(['likely_accept', 'likely_revisions', 'likely_reject']).toContain(result.prediction);
    expect(['high', 'medium', 'low']).toContain(result.confidence);
    expect(result.prediction).toBe('likely_accept');
  });

  test('with bad reviews returns lower probability than good reviews', async () => {
    get.mockResolvedValue(PAPER);
    all.mockResolvedValue(GOOD_REVIEWS);
    const goodResult = await predictor.predict(1);

    get.mockResolvedValue(PAPER);
    all.mockResolvedValue(BAD_REVIEWS);
    const badResult = await predictor.predict(1);

    expect(goodResult.probability).toBeGreaterThan(badResult.probability);
  });

  test('throws for missing paper', async () => {
    get.mockResolvedValue(null);
    all.mockResolvedValue([]);
    await expect(predictor.predict(999)).rejects.toThrow('Paper not found');
  });

  test('high similarity score reduces probability vs clean paper', async () => {
    const highSimPaper = { ...PAPER, similarity_score: 0.92 };

    get.mockResolvedValue(PAPER);
    all.mockResolvedValue(GOOD_REVIEWS);
    const cleanResult = await predictor.predict(1);

    get.mockResolvedValue(highSimPaper);
    all.mockResolvedValue(GOOD_REVIEWS);
    const highSimResult = await predictor.predict(1);

    expect(highSimResult.probability).toBeLessThan(cleanResult.probability);
    expect(highSimResult.factors.integrityPenalty).toBeGreaterThan(0);
  });

  test('confidence scales with number of reviews', async () => {
    get.mockResolvedValue(PAPER);
    all.mockResolvedValue(GOOD_REVIEWS.slice(0, 1));
    const oneReview = await predictor.predict(1);
    expect(oneReview.confidence).toBe('low');

    get.mockResolvedValue(PAPER);
    all.mockResolvedValue(GOOD_REVIEWS);
    const twoReviews = await predictor.predict(1);
    expect(twoReviews.confidence).toBe('medium');

    get.mockResolvedValue(PAPER);
    all.mockResolvedValue([...GOOD_REVIEWS, BAD_REVIEWS[0]]);
    const threeReviews = await predictor.predict(1);
    expect(threeReviews.confidence).toBe('high');
  });
});
