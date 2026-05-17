'use strict';

/**
 * Auth middleware. Two helpers:
 *
 *   requireAuth         - any authenticated user
 *   requireRole(...rs)  - one of the listed roles
 *
 * Both put `req.user = { id, role, username }` on the request when set.
 */

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.redirect('/login?error=Please log in');
  }
  req.user = {
    id: req.session.userId,
    role: req.session.role,
    username: req.session.username,
  };
  next();
}

function requireRole(...roles) {
  return function roleCheck(req, res, next) {
    if (!req.session || !req.session.userId) {
      return res.redirect('/login?error=Please log in');
    }
    if (!roles.includes(req.session.role)) {
      return res.status(403).render('error', {
        title: 'Forbidden',
        message: 'You do not have permission to view this page.',
      });
    }
    req.user = {
      id: req.session.userId,
      role: req.session.role,
      username: req.session.username,
    };
    next();
  };
}

module.exports = { requireAuth, requireRole };
