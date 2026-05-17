'use strict';

const { buildModel, embed, cosine, tokenize } = require('../../src/services/embeddings');

describe('embeddings', () => {
  test('tokenize lowercases and removes stopwords', () => {
    const t = tokenize('The quick BROWN fox jumps over a LAZY dog');
    expect(t).toContain('quick');
    expect(t).toContain('brown');
    expect(t).toContain('fox');
    expect(t).not.toContain('the');
    expect(t).not.toContain('a');
  });

  test('cosine similarity is 1 for identical text', () => {
    const docs = ['transformer based language models', 'transformer based language models'];
    const { vectors } = buildModel(docs);
    expect(cosine(vectors[0], vectors[1])).toBeCloseTo(1, 5);
  });

  test('cosine similarity ranks topical match higher than unrelated', () => {
    const corpus = [
      'machine learning neural networks deep learning',
      'cooking recipes pasta tomato sauce italian',
      'transformers attention mechanism self attention',
    ];
    const { vectors, idf } = buildModel(corpus);
    const target = embed('attention transformers neural networks', idf);
    const scores = vectors.map((v) => cosine(target, v));
    expect(scores[0]).toBeGreaterThan(scores[1]);
    expect(scores[2]).toBeGreaterThan(scores[1]);
  });
});
