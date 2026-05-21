'use strict';

const bcrypt = require('bcrypt');
const User = require('../models/User');
const EmailToken = require('../models/EmailToken');
const jwtService = require('../services/jwt');
const emailService = require('../services/email');
const invitation = require('../services/invitation');
const Review = require('../models/Review');
const Paper = require('../models/Paper');
const N = require('../services/notifications');
const audit = require('../services/auditLog');
const config = require('../config');
const logger = require('../utils/logger');

const SELF_REGISTER_ROLES = ['author', 'reviewer', 'reader'];

function redirectWithError(res, path, message) {
  return res.redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function redirectWithSuccess(res, path, message) {
  return res.redirect(`${path}?success=${encodeURIComponent(message)}`);
}

function clean(value) {
  return String(value || '').trim();
}

function setSession(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = user.id;
      req.session.role = user.role;
      req.session.username = user.username;
      req.session.save((saveErr) => {
        if (saveErr) return reject(saveErr);
        resolve();
      });
    });
  });
}

async function showLogin(req, res) {
  res.render('login', { title: 'Sign in', error: req.query.error || null, success: req.query.success || null });
}

async function showRegister(req, res) {
  res.render('register', { title: 'Create account', error: req.query.error || null });
}

async function login(req, res, next) {
  try {
    const username = clean(req.body.username);
    const password = String(req.body.password || '');
    if (!username || !password) {
      return redirectWithError(res, '/login', 'Please fill in both fields');
    }
    const user = await User.findByUsername(username);
    const ok = user && (await User.verifyPassword(user, password));
    if (!ok) {
      logger.info({ username }, 'Failed login');
      await audit.log(user ? user.id : null, 'login.failed', 'user', null, { username }, req);
      return redirectWithError(res, '/login', 'Invalid username or password');
    }
    if (user.is_active === 0) {
      await audit.log(user.id, 'login.deactivated', 'user', user.id, null, req);
      return redirectWithError(res, '/login', 'Your account has been deactivated. Contact an administrator.');
    }
    await User.touchLastLogin(user.id);
    await audit.log(user.id, 'login.success', 'user', user.id, null, req);
    await setSession(req, user);
    if (user.role === 'admin') return res.redirect('/admin');
    if (user.role === 'editor') return res.redirect('/editor');
    if (user.role === 'reviewer') return res.redirect('/reviewer');
    if (user.role === 'reader') return res.redirect('/reader');
    return res.redirect('/author');
  } catch (err) {
    next(err);
  }
}

async function register(req, res, next) {
  try {
    const username = clean(req.body.username);
    const email = clean(req.body.email);
    const role = clean(req.body.role);
    const expertise = clean(req.body.expertise);
    const affiliation = clean(req.body.affiliation);
    const password = String(req.body.password || '');
    const confirmPassword = String(req.body.confirmPassword || '');

    if (!username || !password || !role) {
      return redirectWithError(res, '/register', 'All required fields must be provided');
    }
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
      return redirectWithError(res, '/register', 'Username: 3-32 chars, letters/numbers/._- only');
    }
    if (!SELF_REGISTER_ROLES.includes(role)) {
      return redirectWithError(res, '/register', 'Invalid role');
    }
    if (password.length < 8) {
      return redirectWithError(res, '/register', 'Password must be at least 8 characters');
    }
    if (!/(?=.*[a-zA-Z])(?=.*[0-9])/.test(password)) {
      return redirectWithError(res, '/register', 'Password must contain at least one letter and one number');
    }
    if (password !== confirmPassword) {
      return redirectWithError(res, '/register', 'Passwords do not match');
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return redirectWithError(res, '/register', 'Please enter a valid email address');
    }
    const existing = await User.findByUsername(username);
    if (existing) {
      return redirectWithError(res, '/register', 'Username is already taken');
    }
    if (email) {
      const emailTaken = await User.findByEmail(email);
      if (emailTaken) return redirectWithError(res, '/register', 'Email is already registered');
    }

    const user = await User.create({ username, email, password, role, expertise, affiliation });
    await audit.log(user.id, 'register', 'user', user.id, { role }, req);

    if (email && config.email.enabled) {
      const token = await EmailToken.create(user.id, 'verify');
      const { subject, html, text } = emailService.verificationEmail(username, token);
      await emailService.send({ to: email, subject, html, text }).catch((e) => logger.warn({ e }, 'Verification email failed'));
      return redirectWithSuccess(res, '/login', 'Account created — check your email to verify your address, then sign in');
    }

    return redirectWithSuccess(res, '/login', 'Account created — please sign in');
  } catch (err) {
    if (err && err.message && err.message.includes('SQLITE_CONSTRAINT')) {
      return redirectWithError(res, '/register', 'That username or email is already in use');
    }
    next(err);
  }
}

async function verifyEmail(req, res, next) {
  try {
    const { token } = req.query;
    if (!token) return redirectWithError(res, '/login', 'Invalid verification link');
    const row = await EmailToken.consume(token, 'verify');
    if (!row) return redirectWithError(res, '/login', 'Verification link is invalid or expired. Please register again or request a new link.');
    await User.markEmailVerified(row.user_id);
    return redirectWithSuccess(res, '/login', 'Email verified — you can now sign in');
  } catch (err) { next(err); }
}

async function showForgotPassword(req, res) {
  res.render('auth/forgot-password', { title: 'Reset password', error: req.query.error || null, success: req.query.success || null });
}

async function forgotPassword(req, res, next) {
  try {
    const email = clean(req.body.email);
    if (!email) return redirectWithError(res, '/auth/forgot-password', 'Please enter your email address');
    // Always show success to prevent user enumeration
    const user = await User.findByEmail(email);
    if (user && config.email.enabled) {
      const token = await EmailToken.create(user.id, 'reset');
      const { subject, html, text } = emailService.passwordResetEmail(user.username, token);
      await emailService.send({ to: email, subject, html, text }).catch((e) => logger.warn({ e }, 'Reset email failed'));
    }
    return redirectWithSuccess(res, '/auth/forgot-password', 'If that email is registered, a reset link has been sent');
  } catch (err) { next(err); }
}

async function showResetPassword(req, res) {
  const { token } = req.query;
  res.render('auth/reset-password', { title: 'Set new password', token: token || '', error: req.query.error || null });
}

async function resetPassword(req, res, next) {
  try {
    const token = clean(req.body.token);
    const password = String(req.body.password || '');
    const confirmPassword = String(req.body.confirmPassword || '');
    if (!token) return redirectWithError(res, '/login', 'Invalid reset link');
    if (password.length < 8) return res.redirect(`/auth/reset-password?token=${encodeURIComponent(token)}&error=${encodeURIComponent('Password must be at least 8 characters')}`);
    if (!/(?=.*[a-zA-Z])(?=.*[0-9])/.test(password)) return res.redirect(`/auth/reset-password?token=${encodeURIComponent(token)}&error=${encodeURIComponent('Password must contain at least one letter and one number')}`);
    if (password !== confirmPassword) return res.redirect(`/auth/reset-password?token=${encodeURIComponent(token)}&error=${encodeURIComponent('Passwords do not match')}`);

    const row = await EmailToken.consume(token, 'reset');
    if (!row) return redirectWithError(res, '/auth/forgot-password', 'Reset link is invalid or expired. Please request a new one.');

    const hash = await bcrypt.hash(password, 10);
    await User.setPassword(row.user_id, hash);
    await jwtService.revokeAllForUser(row.user_id);
    return redirectWithSuccess(res, '/login', 'Password updated — please sign in with your new password');
  } catch (err) { next(err); }
}

function logout(req, res) {
  const userId = req.session.userId;
  audit.log(userId, 'logout', 'user', userId, null, req).catch(() => {});
  req.session.destroy(async () => {
    res.clearCookie(config.session.name);
    if (userId) {
      await jwtService.revokeAllForUser(userId).catch(() => {});
    }
    res.redirect('/');
  });
}

// ── JWT API endpoints ──────────────────────────────────────────────────────────

async function apiLogin(req, res, next) {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    const user = await User.findByUsername(username);
    const ok = user && (await User.verifyPassword(user, password));
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    if (user.is_active === 0) return res.status(403).json({ error: 'Account deactivated' });

    await User.touchLastLogin(user.id);
    const accessToken = jwtService.signAccess(user);
    const { token: refreshToken } = await jwtService.issueRefreshToken(user.id);
    res.json({ accessToken, refreshToken, expiresIn: 900, role: user.role });
  } catch (err) { next(err); }
}

async function apiRefresh(req, res, next) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });
    let result;
    try {
      result = await jwtService.rotateRefreshToken(refreshToken);
    } catch (e) {
      const code = e && e.code;
      if (code === 'TOKEN_REUSE') return res.status(401).json({ error: 'Token reuse detected — all sessions revoked' });
      if (code === 'TOKEN_EXPIRED') return res.status(401).json({ error: 'Refresh token expired' });
      return res.status(401).json({ error: 'Invalid refresh token' });
    }
    const user = await User.findById(result.userId);
    if (!user || user.is_active === 0) return res.status(403).json({ error: 'Account unavailable' });
    const accessToken = jwtService.signAccess(user);
    res.json({ accessToken, refreshToken: result.token, expiresIn: 900 });
  } catch (err) { next(err); }
}

async function apiLogout(req, res, next) {
  try {
    // requireJwt populates req.apiUser — req.user is for session auth
    const userId = req.apiUser && req.apiUser.id;
    if (userId) await jwtService.revokeAllForUser(userId);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// ── Reviewer invitation acceptance ──────────────────────────────────────────

async function showInvite(req, res, next) {
  try {
    const inv = await invitation.findByToken(req.params.token);
    if (!inv || invitation.isExpired(inv) || inv.accepted_at) {
      return res.render('auth/invite-invalid', { title: 'Invalid invitation' });
    }
    res.render('auth/invite', { title: `Review invitation: "${inv.paper_title}"`, inv, error: null });
  } catch (err) { next(err); }
}

async function acceptInvite(req, res, next) {
  try {
    const inv = await invitation.findByToken(req.params.token);
    if (!inv || invitation.isExpired(inv) || inv.accepted_at) {
      return res.render('auth/invite-invalid', { title: 'Invalid invitation' });
    }

    const { username, password } = req.body;
    if (!username || username.length < 3) return res.render('auth/invite', { title: `Review invitation: "${inv.paper_title}"`, inv, error: 'Username must be at least 3 characters' });
    if (!password || password.length < 8) return res.render('auth/invite', { title: `Review invitation: "${inv.paper_title}"`, inv, error: 'Password must be at least 8 characters' });

    // Check username uniqueness
    const existing = await User.findByUsername(username);
    if (existing) return res.render('auth/invite', { title: `Review invitation: "${inv.paper_title}"`, inv, error: 'Username already taken' });

    // Create reviewer account
    const user = await User.create({ username, email: inv.email, password, role: 'reviewer' });
    await invitation.accept(inv.token);

    // Auto-assign to paper
    const paper = await Paper.findById(inv.paper_id);
    if (paper) {
      await Review.assign(inv.paper_id, user.id, null);
      await Paper.updateStatus(inv.paper_id, 'under_review');
      await N.notify(user.id, { kind: 'assignment', title: `New review assignment: ${inv.paper_title}`, body: 'Welcome to PaperSub.AI. Your first review assignment is ready.', link: `/reviewer/papers/${inv.paper_id}` });
    }

    await audit.log(user.id, 'register.invite', 'user', user.id, { paper_id: inv.paper_id }, req);
    await setSession(req, user);
    res.redirect('/reviewer');
  } catch (err) { next(err); }
}

module.exports = {
  showLogin, showRegister, login, register, logout,
  verifyEmail, showForgotPassword, forgotPassword, showResetPassword, resetPassword,
  apiLogin, apiRefresh, apiLogout,
  showInvite, acceptInvite,
};
