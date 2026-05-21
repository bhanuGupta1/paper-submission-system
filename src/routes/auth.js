'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const passport = require('passport');
const ctl = require('../controllers/authController');
const { requireJwt } = require('../middleware/auth');
const { GOOGLE_ENABLED, GITHUB_ENABLED, ORCID_ENABLED } = require('../services/oauth');
const { run, get } = require('../db/connection');
const audit = require('../services/auditLog');

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

// Reviewer invitation acceptance
router.get('/auth/invite/:token', ctl.showInvite);
router.post('/auth/invite/:token', ctl.acceptInvite);

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

// ── ORCID OAuth ───────────────────────────────────────────────────────────────
if (ORCID_ENABLED) {
  router.get('/auth/orcid',
    passport.authenticate('orcid')
  );
  router.get('/auth/orcid/callback',
    passport.authenticate('orcid', { failureRedirect: '/login?error=ORCID+authentication+failed', session: false }),
    async (req, res) => {
      try {
        const profile = req.user; // synthetic profile from strategy
        const orcidId = profile.orcidId || profile.id;
        // If user is already logged in, link ORCID to their account
        if (req.session && req.session.userId) {
          await run('UPDATE users SET orcid_id = ? WHERE id = ?', [orcidId, req.session.userId]);
          await audit.log(req.session.userId, 'orcid.link', 'user', req.session.userId, { orcidId }, req);
          return res.redirect('/author/profile?success=ORCID+iD+connected+successfully');
        }
        // Otherwise find user by ORCID and log them in
        const user = await get('SELECT * FROM users WHERE orcid_id = ?', [orcidId]);
        if (!user) {
          return res.redirect(`/register?orcid=${encodeURIComponent(orcidId)}&name=${encodeURIComponent(profile.displayName || '')}&info=${encodeURIComponent('ORCID verified — complete your account setup below')}`);
        }
        if (user.is_active === 0) return res.redirect('/login?error=Account+deactivated');
        req.session.regenerate((err) => {
          if (err) return res.redirect('/login?error=Session+error');
          req.session.userId = user.id;
          req.session.role = user.role;
          req.session.username = user.username;
          req.session.save(async () => {
            await audit.log(user.id, 'login.orcid', 'user', user.id, { orcidId }, req);
            if (user.role === 'admin') return res.redirect('/admin');
            if (user.role === 'editor') return res.redirect('/editor');
            if (user.role === 'reviewer') return res.redirect('/reviewer');
            return res.redirect('/author');
          });
        });
      } catch (err) {
        res.redirect('/login?error=ORCID+error');
      }
    }
  );
}

// ── ORCID disconnect (POST, requires login) ───────────────────────────────────
router.post('/auth/orcid/disconnect', async (req, res) => {
  if (!req.session || !req.session.userId) return res.redirect('/login');
  await run('UPDATE users SET orcid_id = NULL WHERE id = ?', [req.session.userId]).catch(() => {});
  await audit.log(req.session.userId, 'orcid.unlink', 'user', req.session.userId, null, req);
  res.redirect('/author/profile?success=ORCID+iD+disconnected');
});

module.exports = router;
