'use strict';

const crypto = require('crypto');
const { all, run, get } = require('../db/connection');
const logger = require('../utils/logger');

async function listForOwner(ownerId) {
  return all('SELECT * FROM webhooks WHERE owner_id = ? ORDER BY created_at DESC', [ownerId]);
}

async function findById(id) {
  return get('SELECT * FROM webhooks WHERE id = ?', [id]);
}

async function create({ ownerId, url, events, secret }) {
  const eventsStr = Array.isArray(events) ? events.join(',') : (events || 'submission,decision,review');
  const result = await run(
    'INSERT INTO webhooks (owner_id, url, events, secret) VALUES (?, ?, ?, ?)',
    [ownerId, url, eventsStr, secret || null]
  );
  return findById(result.lastID);
}

async function update(id, { url, events, isActive }) {
  const fields = [];
  const vals = [];
  if (url !== undefined) { fields.push('url = ?'); vals.push(url); }
  if (events !== undefined) {
    fields.push('events = ?');
    vals.push(Array.isArray(events) ? events.join(',') : events);
  }
  if (isActive !== undefined) { fields.push('is_active = ?'); vals.push(isActive ? 1 : 0); }
  if (!fields.length) return;
  vals.push(id);
  await run(`UPDATE webhooks SET ${fields.join(', ')} WHERE id = ?`, vals);
}

async function remove(id) {
  await run('DELETE FROM webhooks WHERE id = ?', [id]);
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

async function deliver(webhook, event, data) {
  const payload = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
  const headers = {
    'Content-Type': 'application/json',
    'X-PaperSub-Event': event,
    'X-PaperSub-Delivery': crypto.randomUUID(),
  };
  if (webhook.secret) {
    headers['X-PaperSub-Signature'] = `sha256=${sign(payload, webhook.secret)}`;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(webhook.url, { method: 'POST', headers, body: payload, signal: controller.signal });
    clearTimeout(timeout);
    await run('UPDATE webhooks SET last_delivery_at = ?, last_delivery_status = ? WHERE id = ?', [
      new Date().toISOString(), res.status, webhook.id,
    ]);
    if (!res.ok) {
      logger.warn({ webhookId: webhook.id, status: res.status, event }, '[webhook] Non-OK delivery');
    }
  } catch (err) {
    await run('UPDATE webhooks SET last_delivery_at = ?, last_delivery_status = 0 WHERE id = ?', [
      new Date().toISOString(), webhook.id,
    ]).catch(() => {});
    logger.warn({ err: err.message, webhookId: webhook.id, event }, '[webhook] Delivery failed');
  }
}

async function fire(event, data) {
  let hooks;
  try {
    hooks = await all(
      "SELECT * FROM webhooks WHERE is_active = 1 AND (',' || events || ',' LIKE ?)",
      [`%,${event},%`]
    );
  } catch {
    return;
  }
  for (const hook of hooks) {
    deliver(hook, event, data).catch(() => {});
  }
}

module.exports = { listForOwner, findById, create, update, remove, fire };
