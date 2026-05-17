'use strict';

const heuristic = require('../../src/services/llm/heuristic');

describe('heuristic LLM backend', () => {
  test('summarize returns at most n sentences', () => {
    const text =
      'This paper proposes a new method. The method is effective. Experiments show improvements. ' +
      'We evaluated on three datasets. The results are reproducible. We release the code.';
    const out = heuristic.summarize(text, 2);
    expect(out.split(/(?<=[.!?])\s+/).length).toBeLessThanOrEqual(2);
  });

  test('extractKeywords returns sensible terms', () => {
    const text =
      'Transformer based neural networks have revolutionised natural language processing. ' +
      'Attention mechanisms allow transformers to capture long-range dependencies in text.';
    const kw = heuristic.extractKeywords(text, 4);
    expect(kw.length).toBe(4);
    expect(kw.every((k) => k.length > 2)).toBe(true);
  });

  test('draftReview returns a valid structured object', () => {
    const draft = heuristic.draftReview({
      title: 'A novel transformer architecture',
      abstract:
        'We propose a novel transformer architecture with self-attention. ' +
        'We evaluate on three benchmark datasets and show consistent improvements over baselines.',
    });
    expect(typeof draft.summary).toBe('string');
    expect(['accept', 'minor_revisions', 'major_revisions', 'reject']).toContain(draft.recommendation);
    expect(draft.novelty_score).toBeGreaterThanOrEqual(1);
    expect(draft.novelty_score).toBeLessThanOrEqual(5);
  });

  test('polishAbstract removes filler words', () => {
    const out = heuristic.polishAbstract('We very basically just propose a really new method.');
    expect(out.revised).not.toMatch(/very|basically|really/i);
  });

  test('suggestTitles returns up to n suggestions', () => {
    const titles = heuristic.suggestTitles(
      'Transformer models for low-resource sentiment analysis with synthetic data augmentation',
      3
    );
    expect(titles.length).toBeLessThanOrEqual(3);
  });
});
