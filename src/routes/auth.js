'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const passport = require('passport');
const ctl = require('../controllers/authController');
const { requireJwt } = require('../middleware/auth');
const { GOOGLE_ENABLED, GITHUB_ENABLED } = require('../services/oauth');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts. Please try again in 15 minutes.',
  skipSuccessfulRequests: true,
});

const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many password reset attempts. Please try again in 1 hour.',
});

// Session-based UI routes
router.get('/login', ctl.showLogin);
router.post('/login', loginLimiter, ctl.login);
router.get('/register', ctl.showRegister);
router.post('/register', loginLimiter, ctl.register);
router.get('/logout', ctl.logout);
router.post('/logout', ctl.logout);

// Email verification & password reset
router.get('/auth/verify-email', ctl.verifyEmail);
router.get('/auth/forgot-password', ctl.showForgotPassword);
router.post('/auth/forgot-password', resetLimiter, ctl.forgotPassword);
router.get('/auth/reset-password', ctl.showResetPassword);
router.post('/auth/reset-password', resetLimiter, ctl.resetPassword);

// JWT API routes
router.post('/api/auth/login', loginLimiter, ctl.apiLogin);
router.post('/api/auth/refresh', ctl.apiRefresh);
router.post('/api/auth/logout', requireJwt, ctl.apiLogout);

// Google OAuth (only registered if credentials are set)
if (GOOGLE_ENABLED) {
  router.get('/auth/google',
    passport.authenticate('google', { scope: ['profile', 'email'] })
  );
  router.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login?error=OAuth+failed' }),
    (req, res) => {
      const user = req.user;
      req.session.regenerate((err) => {
        if (err) return res.redirect('/login?error=Session+error');
        req.session.userId = user.id;
        req.session.role = user.role;
        req.session.username = user.username;
        req.session.save(() => {
          if (user.role === 'admin') return res.redirect('/admin');
          if (user.role === 'editor') return res.redirect('/editor');
          if (user.role === 'reviewer') return res.redirect('/reviewer');
          if (user.role === 'reader') return res.redirect('/reader');
          return res.redirect('/author');
        });
      });
    }
  );
}

// GitHub OAuth (only registered if credentials are set)
if (GITHUB_ENABLED) {
  router.get('/auth/github',
    passport.authenticate('github', { scope: ['user:email'] })
  );
  router.get('/auth/github/callback',
    passport.authenticate('github', { failureRedirect: '/login?error=GitHub+OAuth+failed' }),
    (req, res) => {
      const user = req.user;
      req.session.regenerate((err) => {
        if (err) return res.redirect('/login?error=Session+error');
        req.session.userId = user.id;
        req.session.role = user.role;
        req.session.username = user.username;
        req.session.save(() => {
          if (user.role === 'admin') return res.redirect('/admin');
          if (user.role === 'editor') return res.redirect('/editor');
          if (user.role === 'reviewer') return res.redirect('/reviewer');
          if (user.role === 'reader') return res.redirect('/reader');
          return res.redirect('/author');
        });
      });
    }
  );
}

module.exports = router;
