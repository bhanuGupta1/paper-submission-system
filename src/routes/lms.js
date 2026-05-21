'use strict';

/**
 * LMS webhook receiver — POST /api/lms/:provider/webhook
 *
 * Accepts signed webhook events from Canvas and Moodle.
 * Events are logged to the audit log and can trigger platform actions
 * (e.g. auto-submit a paper when a student submits an LMS assignment).
 *
 * Canvas setup:
 *   Admin → Developer Keys → create key → set webhook URL to
 *   https://your-domain/api/lms/canvas/webhook
 *
 * Moodle setup:
 *   Site admin → Plugins → Webservices → Manage webhooks → add URL
 *   https://your-domain/api/lms/moodle/webhook
 */

const express = require('express');
const { get } = require('../db/connection');
const lms = require('../services/lms');
const audit = require('../services/auditLog');
const logger = require('../utils/logger');

const router = express.Router();

// Use raw body for HMAC verification — must come before express.json()
router.use(express.raw({ type: ['application/json', 'application/x-www-form-urlencoded'], limit: '1mb' }));

router.post('/:provider/webhook', async (req, res) => {
  const { provider } = req.params;
  if (!['canvas', 'moodle', 'generic'].includes(provider)) {
    return res.status(400).json({ error: 'Unknown provider' });
  }

  // Signature verification
  let body;
  try {
    const rawBody = req.body instanceof Buffer ? req.body : Buffer.from(JSON.stringify(req.body));
    const secret = process.env[`LMS_${provider.toUpperCase()}_SECRET`] || '';

    if (provider === 'canvas') {
      const sig = req.headers['x-canvas-signature'] || '';
      if (!lms.verifyCanvasSignature(rawBody, sig, secret)) {
        logger.warn({ provider }, '[lms] Canvas signature verification failed');
        return res.status(401).json({ error: 'Invalid signature' });
      }
    } else if (provider === 'moodle') {
      const token = req.headers['authorization'] || req.query.wstoken || '';
      if (!lms.verifyMoodleToken(token.replace('Bearer ', ''), secret)) {
        logger.warn({ provider }, '[lms] Moodle token verification failed');
        return res.status(401).json({ error: 'Invalid token' });
      }
    }

    body = JSON.parse(rawBody.toString());
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const event = lms.normalise(provider, body);
  logger.info({ provider, kind: event && event.kind }, '[lms] Webhook received');

  // Log to audit trail
  await audit.log(null, `lms.webhook.${provider}`, 'lms', null, { kind: event && event.kind, provider }).catch(() => {});

  // Future: map event → platform action (e.g. auto-submit paper, notify editor)
  // For now, acknowledge receipt and log

  res.json({ ok: true, kind: event && event.kind });
});

// Admin: list registered LMS integrations
router.get('/integrations', async (req, res) => {
  const { all } = require('../db/connection');
  try {
    const rows = await all('SELECT id, provider, name, base_url, is_active, created_at FROM lms_integrations ORDER BY created_at DESC');
    res.json({ integrations: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
