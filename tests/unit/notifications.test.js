'use strict';

const mockRun = jest.fn(async () => ({ lastID: 1, changes: 0 }));
const mockGet = jest.fn(async () => ({ n: 3 }));
const mockAll = jest.fn(async () => ([{ id: 1, title: 'x' }]));

jest.mock('../../src/db/connection', () => ({ run: mockRun, get: mockGet, all: mockAll }));

const N = require('../../src/services/notifications');

describe('notifications', () => {
  beforeEach(() => { mockRun.mockClear(); mockGet.mockClear(); mockAll.mockClear(); });

  test('notify inserts a row', async () => {
    await N.notify(7, { kind: 'assignment', title: 'New paper', body: 'body', link: '/x' });
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  test('notify is a no-op when user is missing', async () => {
    await N.notify(null, { kind: 'x', title: 'x' });
    expect(mockRun).not.toHaveBeenCalled();
  });

  test('unreadCount returns count', async () => {
    const n = await N.unreadCount(7);
    expect(n).toBe(3);
  });

  test('markAllRead executes update', async () => {
    await N.markAllRead(7);
    expect(mockRun).toHaveBeenCalled();
  });
});
