'use strict';

const crypto = require('crypto');
const { run, all, get } = require('../db/connection');

const PREFIX = 'psa_'; // papersub.ai prefix

function generateKey() {
  const random = crypto.randomBytes(32).toString('hex');
  const key = `${PREFIX}${random}`;
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  const prefix = `${PREFIX}${random.slice(0, 8)}`;
  return { key, hash, prefix };
}

async function create({ userId, name, scopes, expiresInDays }) {
  const { key, hash, prefix } = generateKey();
  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 86400 * 1000).toISOString()
    : null;
  await run(
    'INSERT INTO api_keys (user_id, name, key_hash, key_prefix, scopes, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, name, hash, prefix, scopes || 'read:papers', expiresAt]
  );
  return { key, prefix }; // return plaintext key once only
}

async function verify(rawKey) {
  if (!rawKey || !rawKey.startsWith(PREFIX)) return null;
  const hash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const row = await get(
    `SELECT k.*, u.id AS userId, u.username, u.role, u.email
     FROM api_keys k JOIN users u ON u.id = k.user_id
     WHERE k.key_hash = ? AND k.is_active = 1
       AND (k.expires_at IS NULL OR k.expires_at > datetime('now'))`,
    [hash]
  );
  if (!row) return null;
  await run('UPDATE api_keys SET last_used_at = datetime(\'now\') WHERE id = ?', [row.id]);
  return row;
}

async function listForUser(userId) {
  return all(
    'SELECT id, name, key_prefix, scopes, last_used_at, expires_at, is_active, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC',
    [userId]
  );
}

async function revoke(id, userId) {
  return run('UPDATE api_keys SET is_active = 0 WHERE id = ? AND user_id = ?', [id, userId]);
}

async function deleteKey(id, userId) {
  return run('DELETE FROM api_keys WHERE id = ? AND user_id = ?', [id, userId]);
}

function hasScope(keyRow, required) {
  const scopes = (keyRow.scopes || '').split(',').map((s) => s.trim());
  return scopes.includes(required) || scopes.includes('admin');
}

module.exports = { create, verify, listForUser, revoke, deleteKey, hasScope, PREFIX };
