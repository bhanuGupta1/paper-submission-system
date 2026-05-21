'use strict';

const express = require('express');
const ctl = require('../controllers/readerController');

const router = express.Router();
// No auth - public.
router.get('/', ctl.feed);
router.get('/papers/:id', ctl.paperDetail);
router.get('/papers/:id/cite', ctl.citationExport);
router.get('/papers/:id/download', ctl.downloadAccepted);

module.exports = router;
