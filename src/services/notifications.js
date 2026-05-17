'use strict';

const { run, get, all } = require('../db/connection');

async function notify(userId, { kind, title, body, link }) {
  if (!userId) return;
  await run(
    'INSERT INTO notifications (user_id, kind, title, body, link) VALUES (?,?,?,?,?)',
    [userId, kind, title, body || null, link || null]
  );
}

function unreadCount(userId) {
  return get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', [userId])
    .then((r) => (r ? r.n : 0));
}

function list(userId, { limit = 50 } = {}) {
  return all(
    `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    [userId, limit]
  );
}

function markRead(userId, id) {
  return run(
    `UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND user_id = ?`,
    [id, userId]
  );
}

function markAllRead(userId) {
  return run(
    `UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL`,
    [userId]
  );
}

module.exports = { notify, unreadCount, list, markRead, markAllRead };
