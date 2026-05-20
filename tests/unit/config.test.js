'use strict';

describe('config', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  test('trusts one reverse proxy by default in production for secure hosted cookies', () => {
    jest.resetModules();
    process.env.NODE_ENV = 'production';
    process.env.SESSION_SECRET = 'test-production-secret';
    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret';
    delete process.env.TRUST_PROXY;

    const config = require('../../src/config');
    expect(config.trustProxy).toBe(1);
    expect(config.session.secureCookies).toBe(true);
  });

  test('keeps proxy trust disabled by default outside production', () => {
    jest.resetModules();
    process.env.NODE_ENV = 'test';
    process.env.SESSION_SECRET = 'test-secret';
    delete process.env.TRUST_PROXY;

    const config = require('../../src/config');
    expect(config.trustProxy).toBe(false);
    expect(config.session.secureCookies).toBe(false);
  });
});
