'use strict';
const express = require('express');
const router = express.Router();

const auth = require('./auth');
const author = require('./author');
const reviewer = require('./reviewer');
const editor = require('./editor');
const admin = require('./admin');
const reader = require('./reader');
const ai = require('./ai');
const notifications = require('./notifications');
const health = require('./health');
const webhooks = require('./webhooks');

router.get('/', (req, res) => {
  res.render('home', {
    title: 'Paper Submission System',
    user: req.session.userId ? { id: req.session.userId, role: req.session.role, username: req.session.username } : null,
  });
});

router.use(auth);
router.use('/health', health);
router.use('/author', author);
router.use('/reviewer', reviewer);
router.use('/editor', editor);
router.use('/admin', admin);
router.use('/reader', reader);
router.use('/api/ai', ai);
router.use('/notifications', notifications);
router.use('/api/webhooks', webhooks);

module.exports = router;
