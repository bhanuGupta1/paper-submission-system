'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const ctl = require('../controllers/authController');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many login attempts. Try again in 15 minutes.',
});

router.get('/login', ctl.showLogin);
router.post('/login', loginLimiter, ctl.login);
router.get('/register', ctl.showRegister);
router.post('/register', loginLimiter, ctl.register);
router.get('/logout', ctl.logout);
router.post('/logout', ctl.logout);

module.exports = router;
