'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const ctl = require('../controllers/authController');
const { requireJwt } = require('../middleware/auth');

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

module.exports = router;
