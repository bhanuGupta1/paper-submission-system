'use strict';

const User = require('../models/User');
const config = require('../config');
const logger = require('../utils/logger');

const SELF_REGISTER_ROLES = ['author', 'reviewer', 'reader'];

function redirectWithError(res, path, message) {
  return res.redirect(`${path}?error=${encodeURIComponent(message)}`);
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
  res.render('login', { title: 'Sign in', error: req.query.error || null });
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
      return redirectWithError(res, '/login', 'Invalid username or password');
    }
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
      return redirectWithError(res, '/register', 'Username must be 3-32 characters and use only letters, numbers, dots, underscores, or hyphens');
    }
    if (!SELF_REGISTER_ROLES.includes(role)) {
      return redirectWithError(res, '/register', 'Invalid role');
    }
    if (password.length < 8) {
      return redirectWithError(res, '/register', 'Password must be at least 8 characters');
    }
    if (password !== confirmPassword) {
      return redirectWithError(res, '/register', 'Passwords do not match');
    }
    const existing = await User.findByUsername(username);
    if (existing) {
      return redirectWithError(res, '/register', 'Username is already taken');
    }
    await User.create({ username, email, password, role, expertise, affiliation });
    return redirectWithError(res, '/login', 'Account created - please sign in');
  } catch (err) {
    if (err && err.message && err.message.includes('SQLITE_CONSTRAINT')) {
      return redirectWithError(res, '/register', 'That account could not be created because a unique field is already in use');
    }
    next(err);
  }
}

function logout(req, res) {
  req.session.destroy(() => {
    res.clearCookie(config.session.name);
    res.redirect('/');
  });
}

module.exports = { showLogin, showRegister, login, register, logout };
