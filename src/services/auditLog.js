'use strict';

const { run, all, get } = require('../db/connection');

/**
 * Log a significant action to the immutable audit_log table.
 * Safe to call fire-and-forget — errors are swallowed so they never
 * break the primary request.
 */
async function log(userId, action, resourceType, resourceId, details, req) {
  const ip = req
    ? (req.ip || (req.connection && req.connection.remoteAddress) || null)
    : null;
  const ua = req ? (req.headers && req.headers['user-agent']) || null : null;
  const detailsStr = details ? JSON.stringify(details) : null;
  try {
    await run(
      `INSERT INTO audit_log (user_id, action, resource_type, resource_id, details, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId || null, action, resourceType || null, resourceId || null, detailsStr, ip, ua]
    );
  } catch (_) {}
}

/** List audit entries with optional filters. Returns newest-first. */
async function list({ userId, action, resourceType, limit = 100, offset = 0 } = {}) {
  const conditions = [];
  const params = [];

  if (userId) { conditions.push('al.user_id = ?'); params.push(userId); }
  if (action)  { conditions.push('al.action = ?'); params.push(action); }
  if (resourceType) { conditions.push('al.resource_type = ?'); params.push(resourceType); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  params.push(limit, offset);

  return all(
    `SELECT al.*, u.username
     FROM audit_log al
     LEFT JOIN users u ON u.id = al.user_id
     ${where}
     ORDER BY al.created_at DESC
     LIMIT ? OFFSET ?`,
    params
  );
}

async function count({ userId, action, resourceType } = {}) {
  const conditions = [];
  const params = [];
  if (userId) { conditions.push('user_id = ?'); params.push(userId); }
  if (action)  { conditions.push('action = ?'); params.push(action); }
  if (resourceType) { conditions.push('resource_type = ?'); params.push(resourceType); }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const row = await get(`SELECT COUNT(*) AS n FROM audit_log ${where}`, params);
  return row ? row.n : 0;
}

/** Middleware factory — logs the action after next() succeeds. */
function middleware(action, resourceType, getResourceId) {
  return async (req, res, next) => {
    const originalEnd = res.end.bind(res);
    res.end = async function (...args) {
      res.end = originalEnd;
      res.end(...args);
      if (res.statusCode < 400) {
        const userId = req.session?.userId || req.user?.id || null;
        const resourceId = getResourceId ? getResourceId(req, res) : null;
        await log(userId, action, resourceType, resourceId, null, req);
      }
    };
    next();
  };
}

module.exports = { log, list, count, middleware };
