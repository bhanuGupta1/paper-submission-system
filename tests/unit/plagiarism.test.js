'use strict';

const { aiTextLikelihood } = require('../../src/services/plagiarismDetector');

describe('aiTextLikelihood', () => {
  test('returns 0 for very short input', () => {
    expect(aiTextLikelihood('hello').score).toBe(0);
  });

  test('produces a value in [0,1]', () => {
    const text =
      'In this paper, we propose a method. Furthermore, we evaluate it. Moreover, we compare with baselines. ' +
      'In conclusion, our method is effective. It is important to note that results may vary.';
    const out = aiTextLikelihood(text);
    expect(out.score).toBeGreaterThanOrEqual(0);
    expect(out.score).toBeLessThanOrEqual(1);
    expect(typeof out.signals).toBe('object');
  });

  test('uniform sentence-length text scores higher than varied prose', () => {
    const uniform =
      'We propose a method. We test the method. We evaluate the method. We report results. We share the code.';
    const varied =
      'We propose a brand new approach to a long-standing problem. ' +
      'It works. ' +
      'In particular, we revisit a venerable benchmark introduced two decades ago and demonstrate, with appropriate ablations and statistical tests, that our method recovers known results while exposing previously-unreported failure modes.';
    expect(aiTextLikelihood(uniform).score).toBeGreaterThanOrEqual(aiTextLikelihood(varied).score);
  });
});
