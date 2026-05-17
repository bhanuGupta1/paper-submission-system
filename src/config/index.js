'use strict';

const path = require('path');
require('dotenv').config();

const root = path.resolve(__dirname, '..', '..');

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3000,
  sessionSecret:
    process.env.SESSION_SECRET ||
    (process.env.NODE_ENV === 'production'
      ? (() => {
          throw new Error('SESSION_SECRET must be set in production');
        })()
      : 'dev-only-insecure-secret'),
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
