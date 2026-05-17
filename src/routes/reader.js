'use strict';

const express = require('express');
const ctl = require('../controllers/readerController');

const router = express.Router();
// No auth - public.
router.get('/', ctl.feed);
router.get('/papers/:id/download', ctl.downloadAccepted);

module.exports = router;
