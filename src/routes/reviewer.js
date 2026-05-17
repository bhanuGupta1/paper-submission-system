'use strict';

const express = require('express');
const { requireRole } = require('../middleware/auth');
const ctl = require('../controllers/reviewerController');

const router = express.Router();

router.use(requireRole('reviewer', 'admin'));
router.get('/', ctl.dashboard);
router.get('/papers/:paperId', ctl.showReview);
router.get('/papers/:paperId/ai-draft', ctl.aiDraft);
router.post('/reviews/:reviewId', ctl.submit);

module.exports = router;
