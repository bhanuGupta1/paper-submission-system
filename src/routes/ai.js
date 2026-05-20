'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctl = require('../controllers/aiController');

const router = express.Router();
router.use(express.json({ limit: '64kb' }));
router.use(requireAuth);

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many AI requests. Please wait a moment.',
});
router.use(aiLimiter);

// Writing assistant (all authenticated users)
router.post('/polish', ctl.polish);
router.post('/titles', ctl.titles);
router.post('/keywords', ctl.keywords);
router.post('/writing-feedback', ctl.writingFeedback);

// Smart search (all authenticated users)
router.get('/search', ctl.search);

// Editor/admin only
router.get('/review/:reviewId/quality', ctl.checkReviewQuality);
router.get('/paper/:paperId/predict', ctl.predictAcceptance);
router.get('/paper/:paperId/decision-draft', ctl.decisionDraft);

module.exports = router;
