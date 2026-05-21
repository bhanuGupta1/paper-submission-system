'use strict';

const express = require('express');
const fs = require('fs');
const multer = require('multer');
const { requireRole } = require('../middleware/auth');
const ctl = require('../controllers/authorController');
const config = require('../config');

const router = express.Router();

if (!fs.existsSync(config.uploads.dir)) fs.mkdirSync(config.uploads.dir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploads.dir),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: config.uploads.maxBytes },
  fileFilter(req, file, cb) {
    if (config.uploads.allowedMime.includes(file.mimetype)) return cb(null, true);
    cb(new Error(`File type not allowed. Please upload PDF, DOCX, or TXT.`));
  },
});

router.use(requireRole('author', 'admin'));
router.get('/', ctl.dashboard);
router.get('/submit', ctl.showSubmit);

function handleUpload(redirectPath) {
  return function (req, res, next) {
    upload.single('paperFile')(req, res, function (err) {
      if (!err) return next();
      const multer = require('multer');
      const msg = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
        ? 'File is too large. Maximum size is 10 MB.'
        : err.message || 'File upload failed.';
      return res.redirect(`${redirectPath}?error=${encodeURIComponent(msg)}`);
    });
  };
}

router.post('/submit', handleUpload('/author/submit'), ctl.submit);
router.get('/papers/:id', ctl.paperDetail);
router.get('/papers/:id/revise', ctl.showRevise);
router.post('/papers/:id/revise', function (req, res, next) {
  upload.single('paperFile')(req, res, function (err) {
    if (!err) return next();
    const multer = require('multer');
    const msg = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
      ? 'File is too large. Maximum size is 10 MB.'
      : err.message || 'File upload failed.';
    return res.redirect(`/author/papers/${req.params.id}/revise?error=${encodeURIComponent(msg)}`);
  });
}, ctl.submitRevision);
router.get('/papers/:id/download', ctl.downloadPaper);
router.get('/papers/:id/view', ctl.viewPaper);
router.get('/profile', ctl.profile);
router.post('/profile', ctl.updateProfile);
router.post('/profile/notification-prefs', ctl.updateNotificationPrefs);
router.get('/profile/export', ctl.exportMyData);
router.post('/profile/request-deletion', ctl.requestDeletion);

router.get('/api-keys', ctl.listApiKeys);
router.post('/api-keys', ctl.createApiKey);
router.post('/api-keys/:id/revoke', ctl.revokeApiKey);
router.delete('/api-keys/:id', ctl.deleteApiKey);

module.exports = router;
