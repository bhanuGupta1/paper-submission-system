'use strict';

// Pure-function tests don't need the DB-backed COI service, but we
// can still verify the name-token helper indirectly via the public API
// once the DB is initialized. For unit purposes, mock at the require level.

jest.mock('../../src/db/connection', () => ({
  get: jest.fn(async () => null),
  all: jest.fn(async () => []),
  run: jest.fn(async () => ({ lastID: 0, changes: 0 })),
}));

const coi = require('../../src/services/conflictOfInterest');

describe('conflictOfInterest', () => {
  test('self-assignment flagged with highest weight', async () => {
    const paper = { id: 1, author_id: 5, authors: 'Bhanu Gupta', title: 't', abstract: 'a' };
    const reviewer = { id: 5, username: 'bhanu', email: '', expertise: '', affiliation: '' };
    const out = await coi.check(paper, reviewer);
    expect(out.hasConflict).toBe(true);
    expect(out.signals.some((s) => s.kind === 'self')).toBe(true);
  });

  test('clean reviewer has no conflict', async () => {
    const paper = { id: 1, author_id: 5, authors: 'Carol Jones', title: 't', abstract: 'a' };
    const reviewer = { id: 10, username: 'alice_reviewer', email: 'a@elsewhere.edu', expertise: 'NLP', affiliation: 'Other Uni' };
    const { get } = require('../../src/db/connection');
    get.mockImplementation(async (sql) => sql.includes('affiliation') ? { affiliation: 'Some Uni' } : null);
    const out = await coi.check(paper, reviewer);
    expect(out.hasConflict).toBe(false);
  });
});
