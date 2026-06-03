'use strict';

/**
 * Unit tests for the Groq LLM backend.
 *
 * No network: global.fetch is mocked. We verify
 *   1) the backend exposes every method the controllers/services call (parity),
 *   2) structured calls parse the model's JSON into objects,
 *   3) the model fallback chain retries on 429 / 5xx,
 *   4) every method degrades to the offline heuristic (never throws) on failure.
 */

// Must be set BEFORE requiring the backend (config + groq read it at load time).
process.env.GROQ_API_KEY = 'gsk_test_key_not_real';
process.env.GROQ_MODEL = 'llama-3.3-70b-versatile';
process.env.NODE_ENV = 'test';

const groq = require('../../src/services/llm/groq');

// ── fetch mock helpers ─────────────────────────────────────────────────────
function okJson(content) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ choices: [{ message: { content } }] }),
    text: async () => content,
  };
}
function errResponse(status, body = 'error', retryAfter = null) {
  return {
    ok: false,
    status,
    headers: { get: (h) => (h && h.toLowerCase() === 'retry-after' ? retryAfter : null) },
    json: async () => ({}),
    text: async () => body,
  };
}

beforeEach(() => { global.fetch = jest.fn(); });
afterEach(() => { jest.resetAllMocks(); });

describe('groq backend — interface parity', () => {
  // Every method the controllers, writingAssistant, and plagiarismDetector call.
  const required = [
    'complete', 'draftReview', 'summarize', 'extractKeywords', 'polishAbstract', 'suggestTitles',
    'generateDecisionLetter', 'summarizeReviews',
    'deskRejectionCheck', 'ethicsCheck', 'citationHallucinationCheck',
    'toneImprove', 'writingScore', 'sectionFeedback',
    'reviewAssist', 'reviewQualityLlm', 'revisionSummarizer', 'responseToReviewers',
    'analyticsInsights', 'generateRubric', 'detectAiText',
    'plainLanguageSummary', 'keyContributions', 'titleAbstractConsistency', 'limitationsFinder',
    'streamToneImprove',
  ];
  test.each(required)('exposes %s()', (fn) => {
    expect(typeof groq[fn]).toBe('function');
  });
});

describe('groq backend — structured parsing', () => {
  test('draftReview parses JSON object from the model', async () => {
    global.fetch.mockResolvedValueOnce(okJson(JSON.stringify({
      summary: 'A solid study.', strengths: ['clear'], weaknesses: ['small n'],
      novelty_score: 4, clarity_score: 4, significance_score: 3,
      recommendation: 'minor_revisions', confidence: 80,
    })));
    const out = await groq.draftReview({ title: 'T', abstract: 'A'.repeat(200), keywords: 'k' });
    expect(out.recommendation).toBe('minor_revisions');
    expect(out.novelty_score).toBe(4);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('plainLanguageSummary (new feature) parses JSON object', async () => {
    global.fetch.mockResolvedValueOnce(okJson(JSON.stringify({
      plain_summary: 'In plain words.', key_terms_explained: [{ term: 'X', explanation: 'Y' }],
      why_it_matters: 'because', target_reading_level: 'undergraduate', confidence: 75,
    })));
    const out = await groq.plainLanguageSummary('Title', 'Abstract text here.');
    expect(out.plain_summary).toMatch(/plain words/i);
    expect(Array.isArray(out.key_terms_explained)).toBe(true);
  });

  test('extractKeywords pulls a JSON array out of the reply', async () => {
    global.fetch.mockResolvedValueOnce(okJson('Here you go: ["alpha","beta","gamma"]'));
    const out = await groq.extractKeywords('some academic text about alpha and beta', 3);
    expect(out).toEqual(['alpha', 'beta', 'gamma']);
  });
});

describe('groq backend — resilience', () => {
  test('retries past a 429 and succeeds on the next model', async () => {
    global.fetch
      .mockResolvedValueOnce(errResponse(429, 'rate limited', '0'))
      .mockResolvedValueOnce(okJson('A concise summary.'));
    const out = await groq.summarize('x'.repeat(200), 2);
    expect(out).toBe('A concise summary.');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('draftReview falls back to the heuristic when every model fails', async () => {
    global.fetch.mockResolvedValue(errResponse(500, 'upstream down'));
    const out = await groq.draftReview({ title: 'Novel method', abstract: 'We propose a novel approach and evaluate it on a benchmark dataset.' });
    // Heuristic shape: has scores + a recommendation, and is tagged as heuristic.
    expect(out).toHaveProperty('recommendation');
    expect(out.provider).toBe('heuristic');
  });

  test('object features return null (not throw) when the provider is unreachable', async () => {
    global.fetch.mockRejectedValue(new Error('network down'));
    await expect(groq.toneImprove('text')).resolves.toBeNull();
    await expect(groq.keyContributions('t', 'a')).resolves.toBeNull();
    await expect(groq.limitationsFinder('t', 'a', null)).resolves.toBeNull();
  });
});
