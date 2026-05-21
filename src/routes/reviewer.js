'use strict';

const express = require('express');
const { requireRole } = require('../middleware/auth');
const ctl = require('../controllers/reviewerController');

const router = express.Router();
router.use(requireRole('reviewer', 'admin'));
router.use(express.json({ limit: '32kb' }));

router.get('/', ctl.dashboard);
router.get('/papers/:paperId', ctl.showReview);
router.get('/papers/:paperId/view', ctl.viewManuscript);
router.get('/papers/:paperId/ai-draft', ctl.aiDraft);
router.post('/reviews/:reviewId', ctl.submit);
router.post('/reviews/:reviewId/decline', ctl.declineAssignment);
router.post('/papers/:paperId/coi', ctl.declareCoi);
router.post('/papers/:paperId/discussion', ctl.postDiscussion);

module.exports = router;
