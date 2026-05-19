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
  trustProxy: trustProxyFromEnv(process.env.TRUST_PROXY),
  sessionSecret:
    process.env.SESSION_SECRET ||
    (env === 'production'
      ? (() => {
          throw new Error('SESSION_SECRET must be set in production');
        })()
      : 'dev-only-insecure-secret'),
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
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
  paths: { root },
};

module.exports = config;
