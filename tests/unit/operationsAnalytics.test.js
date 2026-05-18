'use strict';

jest.mock('../../src/db/connection', () => ({
  get: jest.fn(),
  all: jest.fn(),
  run: jest.fn(),
}));

const { get, all } = require('../../src/db/connection');
const analytics = require('../../src/services/operationsAnalytics');

describe('operationsAnalytics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('status breakdown fills missing statuses and percentages', async () => {
    all.mockResolvedValueOnce([
      { status: 'pending', count: 2 },
      { status: 'accepted', count: 1 },
    ]);

    const rows = await analytics.getStatusBreakdown();
    expect(rows).toHaveLength(5);
    expect(rows.find((row) => row.status === 'pending')).toMatchObject({ count: 2, percent: 67 });
    expect(rows.find((row) => row.status === 'under_review')).toMatchObject({ count: 0, percent: 0 });
  });

  test('review funnel summarizes completion and score averages', async () => {
    get.mockResolvedValueOnce({
      assignments: 4,
      completed: 3,
      novelty: 4.333,
      clarity: 3,
      significance: 5,
    });

    const funnel = await analytics.getReviewFunnel();
    expect(funnel).toMatchObject({ assignments: 4, completed: 3, pending: 1, completionRate: 75 });
    expect(funnel.averageScores).toMatchObject({ novelty: '4.3', clarity: '3.0', significance: '5.0' });
  });
});
