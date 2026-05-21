'use strict';

const apiKeys = require('../services/apiKeys');

function requireApiKey(scopeRequired) {
  return async (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const raw = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : (req.query.api_key || '');
    if (!raw) return res.status(401).json({ error: 'API key required. Pass as Authorization: Bearer <key> or ?api_key=<key>' });
    const keyRow = await apiKeys.verify(raw).catch(() => null);
    if (!keyRow) return res.status(401).json({ error: 'Invalid or expired API key' });
    if (scopeRequired && !apiKeys.hasScope(keyRow, scopeRequired)) {
      return res.status(403).json({ error: `Scope '${scopeRequired}' required` });
    }
    req.apiKey = keyRow;
    req.apiUser = { id: keyRow.userId, username: keyRow.username, role: keyRow.role };
    next();
  };
}

module.exports = { requireApiKey };
