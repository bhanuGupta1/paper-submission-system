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

module.exports = router;
