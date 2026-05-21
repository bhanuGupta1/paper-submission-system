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
const lms = require('./lms');
const publicApi = require('./publicApi');
const apiDocs = require('./apiDocs');

router.get('/', (req, res) => {
  res.render('home', {
    title: 'Paper Submission System',
    user: req.session.userId ? { id: req.session.userId, role: req.session.role, username: req.session.username } : null,
  });
});

router.get('/privacy', (req, res) => res.render('privacy', { title: 'Privacy policy' }));

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
router.use('/api/lms', lms);
router.use('/api/v1', publicApi);
router.use('/api/docs', apiDocs);

module.exports = router;
