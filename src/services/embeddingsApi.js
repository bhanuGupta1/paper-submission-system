'use strict';

/**
 * OpenAI-compatible embeddings client.
 *
 * Groq has NO embeddings endpoint, so the similarity features that opt into
 * "real" embeddings (reviewer matching, plagiarism similarity, smart search)
 * call one of the providers below instead. They all speak the OpenAI shape:
 *
 *   POST {baseUrl}/embeddings  { model, input: [string, ...] }
 *     -> { data: [ { index, embedding: [number, ...] }, ... ] }
 *
 * Select a backend with EMBEDDINGS_PROVIDER and supply EMBEDDINGS_API_KEY.
 * Verified working presets (June 2026) — override the model with EMBEDDINGS_MODEL
 * and/or the base URL with EMBEDDINGS_BASE_URL (use provider "custom" for anything
 * else that exposes an OpenAI-compatible /embeddings route).
 */

const config = require('../config');
const logger = require('../utils/logger');

// provider -> { baseUrl, model }. Free/low-cost retrieval models that work well
// for short paper/abstract text. All are OpenAI-compatible /embeddings endpoints.
const PRESETS = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'text-embedding-3-small' },
  jina: { baseUrl: 'https://api.jina.ai/v1', model: 'jina-embeddings-v3' },
  voyage: { baseUrl: 'https://api.voyageai.com/v1', model: 'voyage-3.5-lite' },
  mistral: { baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-embed' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-embedding-001' },
  nomic: { baseUrl: 'https://api-atlas.nomic.ai/v1', model: 'nomic-embed-text-v1.5' },
};

// Resolve the effective { provider, baseUrl, model, apiKey } from config + presets.
function resolve() {
  const provider = (config.embeddings.provider || '').toLowerCase();
  const preset = PRESETS[provider] || null;
  const baseUrl = String(config.embeddings.baseUrl || (preset && preset.baseUrl) || '').replace(/\/+$/, '');
  const model = config.embeddings.model || (preset && preset.model) || '';
  const apiKey = config.embeddings.apiKey || '';
  return { provider, baseUrl, model, apiKey };
}

// True only when we have everything needed to make a call.
function isConfigured() {
  const { baseUrl, model, apiKey } = resolve();
  return Boolean(baseUrl && model && apiKey);
}

// Embed one batch (<= a few hundred strings). Returns dense vectors aligned to input order.
async function embedBatch(texts) {
  const { baseUrl, model, apiKey } = resolve();
  if (!baseUrl || !model || !apiKey) {
    throw new Error('embeddings API not configured (need EMBEDDINGS_PROVIDER/MODEL/API_KEY)');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.embeddings.timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input: texts, encoding_format: 'float' }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`embeddings ${res.status}: ${body.slice(0, 200)}`);
    }

    const json = await res.json();
    const data = Array.isArray(json.data) ? json.data : [];
    if (!data.length) throw new Error('embeddings response had no data');

    // Honour the `index` field so order is guaranteed regardless of provider.
    const out = new Array(texts.length);
    data.forEach((d, i) => {
      const idx = typeof d.index === 'number' ? d.index : i;
      out[idx] = d.embedding;
    });
    return out;
  } finally {
    clearTimeout(timer);
  }
}

// Embed an arbitrary number of texts, chunked to EMBEDDINGS_MAX_BATCH.
async function embedMany(texts) {
  const list = Array.isArray(texts) ? texts : [texts];
  const max = Math.max(1, config.embeddings.maxBatch || 64);
  const out = [];
  for (let i = 0; i < list.length; i += max) {
    const chunk = list.slice(i, i + max);
    // eslint-disable-next-line no-await-in-loop
    const vecs = await embedBatch(chunk);
    out.push(...vecs);
  }
  return out;
}

// Embed a single text -> one dense vector.
async function embedOne(text) {
  const [v] = await embedMany([text]);
  return v;
}

module.exports = { PRESETS, resolve, isConfigured, embedBatch, embedMany, embedOne };

// Silence "unused" in setups that lint this file in isolation; logger is used by callers.
void logger;
