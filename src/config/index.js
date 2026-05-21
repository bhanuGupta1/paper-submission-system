'use strict';

const path = require('path');
require('dotenv').config();

const root = path.resolve(__dirname, '..', '..');
const env = process.env.NODE_ENV || 'development';

function boolFromEnv(value, fallback = false) {
  if (typeof value === 'undefined' || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function trustProxyFromEnv(value) {
  if (typeof value === 'undefined' || value === '') return env === 'production' ? 1 : false;
  if (['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())) return 1;
  if (['0', 'false', 'no', 'off'].includes(String(value).toLowerCase())) return false;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? value : parsed;
}

const config = {
  env,
  port: parseInt(process.env.PORT, 10) || 3000,
  appUrl: process.env.APP_URL || `http://localhost:${parseInt(process.env.PORT, 10) || 3000}`,
  trustProxy: trustProxyFromEnv(process.env.TRUST_PROXY),
  sessionSecret:
    process.env.SESSION_SECRET ||
    (env === 'production'
      ? (() => { throw new Error('SESSION_SECRET must be set in production'); })()
      : 'dev-only-insecure-secret'),
  jwtSecret:
    process.env.JWT_SECRET ||
    (env === 'production'
      ? (() => { throw new Error('JWT_SECRET must be set in production'); })()
      : 'dev-only-jwt-secret-change-me'),
  jwtRefreshSecret:
    process.env.JWT_REFRESH_SECRET ||
    (env === 'production'
      ? (() => { throw new Error('JWT_REFRESH_SECRET must be set in production'); })()
      : 'dev-only-jwt-refresh-secret-change-me'),
  session: {
    name: process.env.SESSION_COOKIE_NAME || 'papersub.sid',
    secureCookies: boolFromEnv(process.env.SESSION_COOKIE_SECURE, env === 'production'),
  },
  db: {
    path: process.env.DB_PATH
      ? path.resolve(root, process.env.DB_PATH)
      : path.join(root, 'data', 'paper_submission.db'),
  },
  uploads: {
    dir: process.env.UPLOAD_DIR
      ? path.resolve(root, process.env.UPLOAD_DIR)
      : path.join(root, 'uploads'),
    maxBytes: (parseInt(process.env.MAX_UPLOAD_MB, 10) || 10) * 1024 * 1024,
    allowedMime: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
    ],
  },
  llm: {
    provider: (process.env.LLM_PROVIDER || 'heuristic').toLowerCase(),
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY || '',
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    },
  },
  email: {
    host: process.env.SMTP_HOST || 'localhost',
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: boolFromEnv(process.env.SMTP_SECURE, false),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.EMAIL_FROM || 'noreply@papersubmission.local',
    enabled: boolFromEnv(process.env.EMAIL_ENABLED, false),
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
  oauth: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID || '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
    },
    orcid: {
      clientId: process.env.ORCID_CLIENT_ID || '',
      clientSecret: process.env.ORCID_CLIENT_SECRET || '',
      sandbox: boolFromEnv(process.env.ORCID_SANDBOX, false),
    },
  },
  paths: { root },
};

module.exports = config;
