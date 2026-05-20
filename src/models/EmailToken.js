'use strict';

const crypto = require('crypto');
const { run, get } = require('../db/connection');

const VERIFY_TTL_H = 24;
const RESET_TTL_H = 1;

async function create(userId, kind) {
  const token = crypto.randomBytes(32).toString('hex');
  const ttlHours = kind === 'verify' ? VERIFY_TTL_H : RESET_TTL_H;
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
  // Invalidate any existing unused tokens of this kind for the user
  await run('UPDATE email_tokens SET used_at = datetime(\'now\') WHERE user_id = ? AND kind = ? AND used_at IS NULL', [userId, kind]);
  await run(
    'INSERT INTO email_tokens (user_id, token, kind, expires_at) VALUES (?,?,?,?)',
    [userId, token, kind, expiresAt]
  );
  return token;
}

async function consume(token, kind) {
  const row = await get(
    'SELECT * FROM email_tokens WHERE token = ? AND kind = ? AND used_at IS NULL',
    [token, kind]
  );
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  await run('UPDATE email_tokens SET used_at = datetime(\'now\') WHERE id = ?', [row.id]);
  return row;
}

module.exports = { create, consume };
