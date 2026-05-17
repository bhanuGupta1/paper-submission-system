'use strict';

/**
 * Light integration smoke tests. Boots a fresh in-tempdir SQLite DB,
 * runs the migration, hits a few endpoints with supertest. Designed to
 * catch wiring regressions, not exercise the full flow.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// Point everything at a throwaway dir BEFORE requiring app/db.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pss-test-'));
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret-please-ignore';
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
fs.mkdirSync(process.env.UPLOAD_DIR, { recursive: true });

const request = require('supertest');
const migrate = require('../../src/db/migrate');
const createApp = require('../../src/app');

let app;
beforeAll(async () => {
  await migrate();
  app = createApp();
});

describe('smoke', () => {
  test('GET / responds 200', async () => {
    const r = await request(app).get('/');
    expect(r.status).toBe(200);
    expect(r.text).toMatch(/Paper Submission System/);
  });

  test('protected pages redirect when not logged in', async () => {
    const r = await request(app).get('/author');
    expect([302, 401, 403]).toContain(r.status);
  });

  test('register + login + author dashboard', async () => {
    const agent = request.agent(app);
    const r1 = await agent.post('/register').type('form').send({
      username: 'testuser',
      password: 'Password123!',
      role: 'author',
    });
    expect([200, 302]).toContain(r1.status);

    const r2 = await agent.post('/login').type('form').send({
      username: 'testuser',
      password: 'Password123!',
    });
    expect([200, 302]).toContain(r2.status);

    const r3 = await agent.get('/author');
    expect(r3.status).toBe(200);
    expect(r3.text).toMatch(/My submissions/);
  });
});
