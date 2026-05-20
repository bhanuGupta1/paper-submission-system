'use strict';
const N = require('../services/notifications');

async function list(req, res, next) {
  try {
    const items = await N.list(req.user.id, { limit: 100 });
    res.render('notifications/index', { title: 'Notifications', items });
  } catch (err) { next(err); }
}

async function markRead(req, res, next) {
  try {
    await N.markRead(req.user.id, req.params.id);
    res.redirect('/notifications');
  } catch (err) { next(err); }
}

async function markAllRead(req, res, next) {
  try {
    await N.markAllRead(req.user.id);
    res.redirect('/notifications');
  } catch (err) { next(err); }
}

async function unreadCount(req, res, next) {
  try {
    const count = await N.unreadCount(req.user.id);
    res.json({ count });
  } catch (err) { next(err); }
}

module.exports = { list, markRead, markAllRead, unreadCount };
