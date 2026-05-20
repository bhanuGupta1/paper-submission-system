'use strict';

const jwtService = require('../services/jwt');
const User = require('../models/User');

// Session-based auth — verify user is still active and role has not changed.
async function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.redirect('/login?error=' + encodeURIComponent('Please log in'));
  }
  try {
    const user = await User.findById(req.session.userId);
    if (!user || user.is_active === 0) {
      req.session.destroy(() => {});
      return res.redirect('/login?error=' + encodeURIComponent('Your account is no longer active'));
    }
    // Keep session role in sync with DB in case admin changed it
    if (user.role !== req.session.role) {
      req.session.role = user.role;
    }
    req.user = { id: user.id, role: user.role, username: user.username };
    next();
  } catch (err) {
    next(err);
  }
}

function requireRole(...roles) {
  return async function roleCheck(req, res, next) {
    if (!req.session || !req.session.userId) {
      return res.redirect('/login?error=' + encodeURIComponent('Please log in'));
    }
    try {
      const user = await User.findById(req.session.userId);
      if (!user || user.is_active === 0) {
        req.session.destroy(() => {});
        return res.redirect('/login?error=' + encodeURIComponent('Your account is no longer active'));
      }
      if (!roles.includes(user.role)) {
        return res.status(403).render('errors/403', { title: 'Forbidden', message: 'You do not have permission to view this page.' });
      }
      if (user.role !== req.session.role) req.session.role = user.role;
      req.user = { id: user.id, role: user.role, username: user.username };
      next();
    } catch (err) {
      next(err);
    }
  };
}

// JWT bearer auth — for /api/* routes.
function requireJwt(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Bearer token required' });
  }
  try {
    const payload = jwtService.verifyAccess(header.slice(7));
    req.apiUser = { id: payload.sub, role: payload.role, username: payload.username };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return res.status(401).json({ error: 'Token expired' });
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireJwtRole(...roles) {
  return function (req, res, next) {
    requireJwt(req, res, () => {
      if (!roles.includes(req.apiUser.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      next();
    });
  };
}

module.exports = { requireAuth, requireRole, requireJwt, requireJwtRole };
