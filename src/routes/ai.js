'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const ctl = require('../controllers/aiController');

const router = express.Router();
router.use(express.json({ limit: '64kb' }));
router.use(requireAuth);

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});
router.use(aiLimiter);

router.post('/polish', ctl.polish);
router.post('/titles', ctl.titles);
router.post('/keywords', ctl.keywords);

module.exports = router;
