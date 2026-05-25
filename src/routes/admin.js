'use strict';

const express = require('express');
const { requireRole } = require('../middleware/auth');
const ctl = require('../controllers/adminController');

const router = express.Router();
router.use(requireRole('admin'));
router.use(express.json({ limit: '32kb' }));

router.get('/', ctl.dashboard);
router.get('/users', ctl.listUsers);
router.post('/users/update', ctl.updateUser);
router.get('/tracks', ctl.listTracks);
router.post('/tracks', ctl.createTrack);
router.post('/tracks/:id', ctl.updateTrack);
router.post('/tracks/:id/delete', ctl.deleteTrack);
router.get('/export.xlsx', ctl.exportXlsx);
router.get('/export.csv', ctl.exportCsv);
router.get('/audit-log', ctl.auditLogView);
router.get('/audit-log.csv', ctl.auditLogCsv);
router.get('/backup', ctl.backupView);
router.post('/backup', ctl.triggerBackup);
router.get('/backup/download/:filename', ctl.downloadBackup);

router.get('/lms', ctl.lmsView);
router.post('/lms', ctl.createLmsIntegration);
router.post('/lms/:id/toggle', ctl.toggleLmsIntegration);
router.post('/lms/:id/delete', ctl.deleteLmsIntegration);

router.post('/digest', ctl.triggerDigest);
router.get('/ai-status', ctl.aiStatus);
router.post('/rerun-ai-detection', ctl.rerunAiDetection);

module.exports = router;
