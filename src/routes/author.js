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
router.post('/submit', upload.single('paperFile'), ctl.submit);
router.get('/papers/:id', ctl.paperDetail);
router.get('/papers/:id/revise', ctl.showRevise);
router.post('/papers/:id/revise', upload.single('paperFile'), ctl.submitRevision);
router.get('/papers/:id/download', ctl.downloadPaper);
router.get('/profile', ctl.profile);
router.post('/profile', ctl.updateProfile);

module.exports = router;
