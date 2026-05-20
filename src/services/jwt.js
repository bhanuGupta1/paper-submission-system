'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { run, get, all, withTransaction } = require('../db/connection');

const ACCESS_TTL = '15m';
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function signAccess(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, username: user.username },
    config.jwtSecret,
    { expiresIn: ACCESS_TTL, issuer: 'papersub' }
  );
}

function verifyAccess(token) {
  return jwt.verify(token, config.jwtSecret, { issuer: 'papersub' });
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function issueRefreshToken(userId) {
  const token = crypto.randomBytes(40).toString('hex');
  const family = crypto.randomBytes(16).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS).toISOString();
  await run(
    'INSERT INTO refresh_tokens (user_id, token_hash, family, expires_at) VALUES (?,?,?,?)',
    [userId, tokenHash, family, expiresAt]
  );
  return { token, family };
}

async function rotateRefreshToken(incomingToken) {
  const tokenHash = hashToken(incomingToken);

  // Pre-flight: check token exists before acquiring the exclusive lock
  const candidate = await get('SELECT * FROM refresh_tokens WHERE token_hash = ?', [tokenHash]);
  if (!candidate) throw { code: 'INVALID_TOKEN' };

  return withTransaction(async () => {
    // Re-read inside transaction for isolation
    const stored = await get('SELECT * FROM refresh_tokens WHERE token_hash = ?', [tokenHash]);
    if (!stored) throw { code: 'INVALID_TOKEN' };

    if (stored.revoked_at) {
      // Token reuse detected — revoke entire family
      await run('UPDATE refresh_tokens SET revoked_at = datetime(\'now\') WHERE family = ? AND revoked_at IS NULL', [stored.family]);
      throw { code: 'TOKEN_REUSE' };
    }
    if (new Date(stored.expires_at) < new Date()) {
      await run('UPDATE refresh_tokens SET revoked_at = datetime(\'now\') WHERE id = ?', [stored.id]);
      throw { code: 'TOKEN_EXPIRED' };
    }

    // Atomically revoke this token — if another concurrent rotation already revoked it, changes = 0
    const result = await run(
      'UPDATE refresh_tokens SET revoked_at = datetime(\'now\') WHERE id = ? AND revoked_at IS NULL',
      [stored.id]
    );
    if (result.changes === 0) {
      // Race: another request already rotated this token — treat as reuse
      await run('UPDATE refresh_tokens SET revoked_at = datetime(\'now\') WHERE family = ? AND revoked_at IS NULL', [stored.family]);
      throw { code: 'TOKEN_REUSE' };
    }

    const newToken = crypto.randomBytes(40).toString('hex');
    const newHash = hashToken(newToken);
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS).toISOString();
    await run(
      'INSERT INTO refresh_tokens (user_id, token_hash, family, expires_at) VALUES (?,?,?,?)',
      [stored.user_id, newHash, stored.family, expiresAt]
    );

    return { token: newToken, userId: stored.user_id };
  });
}

async function revokeAllForUser(userId) {
  await run('UPDATE refresh_tokens SET revoked_at = datetime(\'now\') WHERE user_id = ? AND revoked_at IS NULL', [userId]);
}

async function pruneExpired() {
  await run('DELETE FROM refresh_tokens WHERE expires_at < datetime(\'now\') AND created_at < datetime(\'now\',\'-1 day\')');
}

module.exports = { signAccess, verifyAccess, issueRefreshToken, rotateRefreshToken, revokeAllForUser, pruneExpired };
