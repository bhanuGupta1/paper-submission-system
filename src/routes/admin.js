'use strict';

const express = require('express');
const { requireRole } = require('../middleware/auth');
const ctl = require('../controllers/adminController');

const router = express.Router();
router.use(requireRole('admin'));
router.get('/', ctl.dashboard);
router.get('/export.xlsx', ctl.exportXlsx);

module.exports = router;
