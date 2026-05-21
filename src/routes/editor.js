'use strict';

const express = require('express');
const { requireRole } = require('../middleware/auth');
const ctl = require('../controllers/editorController');

const router = express.Router();
router.use(requireRole('editor', 'admin'));
router.use(express.json({ limit: '32kb' }));

router.get('/', ctl.dashboard);
router.post('/assign-reviewer', ctl.assignReviewer);
router.post('/bulk-assign', ctl.bulkAssign);
router.post('/decide', ctl.decide);
router.post('/papers/:id/tags', ctl.updateTags);
router.get('/papers/:id/download', ctl.downloadManuscript);
router.get('/papers/:id/view', ctl.viewManuscript);
router.get('/review-progress', ctl.reviewProgress);
router.get('/papers/:id/audit', ctl.auditTrail);
router.get('/papers/:id/letters', ctl.viewDecisionLetter);
router.get('/papers/:id/discussion', ctl.getDiscussion);
router.post('/papers/:id/discussion', ctl.postDiscussion);
router.post('/papers/:id/invite-reviewer', ctl.inviteReviewer);
router.get('/papers/:id/invitations', ctl.listInvitations);
router.get('/analytics', ctl.analyticsView);

module.exports = router;
