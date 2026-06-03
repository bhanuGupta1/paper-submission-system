'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const ctl = require('../controllers/aiController');

const router = express.Router();
router.use(requireAuth);

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many AI requests. Please wait a moment.',
});

// SSE streaming — no JSON body parser, no rate limit (handled per-request)
router.get('/stream/tone-improve', ctl.toneImproveStream);

router.use(express.json({ limit: '128kb' }));
router.use(aiLimiter);

// ── Author writing tools ──────────────────────────────────────────────────────
router.post('/polish', ctl.polish);
router.post('/titles', ctl.titles);
router.post('/keywords', ctl.keywords);
router.post('/writing-feedback', ctl.writingFeedback);
router.post('/tone-improve', ctl.toneImprove);
router.post('/writing-score', ctl.writingScore);
router.post('/section-feedback', ctl.sectionFeedback);
router.post('/plain-summary', ctl.plainSummary);
router.post('/key-contributions', ctl.keyContributions);
router.post('/title-check', ctl.titleCheck);
router.post('/limitations', ctl.limitations);

// ── Pre-submission screening ──────────────────────────────────────────────────
router.post('/pre-submission-check', ctl.preSubmissionCheck);
router.post('/ethics-check', ctl.ethicsCheck);
router.post('/citation-check', ctl.citationCheck);

// ── Smart search ──────────────────────────────────────────────────────────────
router.get('/search', ctl.search);

// ── Reviewer tools ────────────────────────────────────────────────────────────
router.post('/review-assist', ctl.reviewAssist);
router.get('/paper/:paperId/rubric', ctl.generateRubric);

// ── Author revision tools (author or editor/admin) ────────────────────────────
router.get('/paper/:paperId/revision-summary', ctl.revisionSummary);
router.post('/paper/:paperId/response-to-reviewers', ctl.responseToReviewers);

// ── Editor / admin tools ──────────────────────────────────────────────────────
router.get('/review/:reviewId/quality', ctl.checkReviewQuality);
router.get('/review/:reviewId/quality-llm', ctl.reviewQualityLlm);
router.get('/paper/:paperId/predict', ctl.predictAcceptance);
router.get('/paper/:paperId/decision-draft', ctl.decisionDraft);
router.get('/paper/:paperId/review-summary', ctl.reviewSummary);
router.get('/analytics-insights', ctl.analyticsInsights);

module.exports = router;
