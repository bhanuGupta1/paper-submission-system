'use strict';

const path = require('path');
require('dotenv').config();

const root = path.resolve(__dirname, '..', '..');
const env = process.env.NODE_ENV || 'development';

function boolFromEnv(value, fallback = false) {
  if (typeof value === 'undefined' || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

// Tri-state: true / false / undefined. Undefined means "inherit the global default".
function triBoolFromEnv(value) {
  if (typeof value === 'undefined' || value === '') return undefined;
  const v = String(value).toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return undefined;
}

function trustProxyFromEnv(value) {
  if (typeof value === 'undefined' || value === '') return env === 'production' ? 1 : false;
  if (['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())) return 1;
  if (['0', 'false', 'no', 'off'].includes(String(value).toLowerCase())) return false;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? value : parsed;
}

// True when any hosted-LLM key is present — used as the default for AI_PREFER_API.
const hasLlmKey = !!(process.env.GROQ_API_KEY || process.env.OPENROUTER_API_KEY);

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
    provider: (() => {
      const explicit = (process.env.LLM_PROVIDER || '').toLowerCase();
      if (explicit) return explicit;
      if (process.env.GROQ_API_KEY) return 'groq';
      if (process.env.OPENROUTER_API_KEY) return 'openrouter';
      return 'heuristic';
    })(),
    openrouter: {
      apiKey: process.env.OPENROUTER_API_KEY || '',
      model: process.env.OPENROUTER_MODEL || 'moonshotai/kimi-k2.6:free', // fallback chain in openrouter.js if this is rate-limited
    },
    groq: {
      apiKey: process.env.GROQ_API_KEY || '',
      // Default primary model; groq.js routes per-task and falls back across a chain.
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      // Optional hard timeout per request (ms). Groq is fast, so this can be tight.
      timeoutMs: parseInt(process.env.GROQ_TIMEOUT_MS, 10) || 30000,
    },
  },
  // Embeddings backend for the similarity features (reviewer matching, plagiarism
  // similarity, smart search). Groq has NO embeddings endpoint, so "real" API
  // embeddings use an OpenAI-compatible provider below. Default is offline TF-IDF.
  //   EMBEDDINGS_PROVIDER: tfidf (default) | st | openai | jina | voyage | gemini | mistral | nomic | custom
  embeddings: {
    provider: (process.env.EMBEDDINGS_PROVIDER || 'tfidf').toLowerCase(),
    apiKey: process.env.EMBEDDINGS_API_KEY || '',
    baseUrl: process.env.EMBEDDINGS_BASE_URL || '',
    model: process.env.EMBEDDINGS_MODEL || '',
    timeoutMs: parseInt(process.env.EMBEDDINGS_TIMEOUT_MS, 10) || 15000,
    maxBatch: parseInt(process.env.EMBEDDINGS_MAX_BATCH, 10) || 64,
  },
  // Per-feature API/offline switch. `preferApi` is the global default (on when a
  // provider key is set); each feature can override via AI_FEATURE_* (true/false).
  // Resolve with config.useApiFor(feature).
  ai: {
    preferApi: (() => {
      const t = triBoolFromEnv(process.env.AI_PREFER_API);
      return typeof t === 'boolean' ? t : hasLlmKey;
    })(),
    feature: {
      summary: triBoolFromEnv(process.env.AI_FEATURE_SUMMARY),
      keywords: triBoolFromEnv(process.env.AI_FEATURE_KEYWORDS),
      titles: triBoolFromEnv(process.env.AI_FEATURE_TITLES),
      abstract: triBoolFromEnv(process.env.AI_FEATURE_ABSTRACT),
      metadata: triBoolFromEnv(process.env.AI_FEATURE_METADATA),
      review: triBoolFromEnv(process.env.AI_FEATURE_REVIEW),
      aiTextDetect: triBoolFromEnv(process.env.AI_FEATURE_AI_TEXT),
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

// Resolve whether a given feature should use the hosted API: an explicit
// per-feature flag wins, otherwise fall back to the global preferApi default.
config.useApiFor = function useApiFor(feature) {
  const f = config.ai.feature[feature];
  return typeof f === 'boolean' ? f : config.ai.preferApi;
};

module.exports = config;
