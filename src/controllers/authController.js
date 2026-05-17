'use strict';

const User = require('../models/User');
const logger = require('../utils/logger');

async function showLogin(req, res) {
  res.render('login', { title: 'Sign in', error: req.query.error || null });
}

async function showRegister(req, res) {
  res.render('register', { title: 'Create account', error: req.query.error || null });
}

async function login(req, res, next) {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.redirect('/login?error=Please fill in both fields');
    }
    const user = await User.findByUsername(username);
    const ok = user && (await User.verifyPassword(user, password));
    if (!ok) {
      logger.info({ username }, 'Failed login');
      return res.redirect('/login?error=Invalid username or password');
    }
    req.session.userId = user.id;
    req.session.role = user.role;
    req.session.username = user.username;
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
    const { username, email, password, role, expertise } = req.body;
    if (!username || !password || !role) {
      return res.redirect('/register?error=All required fields must be provided');
    }
    if (!User.ROLES.includes(role)) {
      return res.redirect('/register?error=Invalid role');
    }
    if (password.length < 8) {
      return res.redirect('/register?error=Password must be at least 8 characters');
    }
    const existing = await User.findByUsername(username);
    if (existing) {
      return res.redirect('/register?error=Username is already taken');
    }
    await User.create({ username, email, password, role, expertise: expertise || '' });
    return res.redirect('/login?error=Account created - please sign in');
  } catch (err) {
    next(err);
  }
}

function logout(req, res) {
  req.session.destroy(() => res.redirect('/'));
}

module.exports = { showLogin, showRegister, login, register, logout };
