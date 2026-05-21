'use strict';

const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const wh = require('../services/webhooks');
const router = express.Router();

router.use(express.json());

// List
router.get('/', requireAuth, requireRole('editor', 'admin'), async (req, res, next) => {
  try {
    const hooks = await wh.listForOwner(req.user.id);
    res.json({ webhooks: hooks });
  } catch (err) { next(err); }
});

// Create
router.post('/', requireAuth, requireRole('editor', 'admin'), async (req, res, next) => {
  try {
    const { url, events, secret } = req.body;
    if (!url || !/^https?:\/\/.+/.test(url)) return res.status(400).json({ error: 'Valid URL required' });
    const hook = await wh.create({ ownerId: req.user.id, url, events, secret });
    res.status(201).json({ webhook: hook });
  } catch (err) { next(err); }
});

// Update
router.patch('/:id', requireAuth, requireRole('editor', 'admin'), async (req, res, next) => {
  try {
    const hook = await wh.findById(req.params.id);
    if (!hook || hook.owner_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
    await wh.update(hook.id, req.body);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Delete
router.delete('/:id', requireAuth, requireRole('editor', 'admin'), async (req, res, next) => {
  try {
    const hook = await wh.findById(req.params.id);
    if (!hook || hook.owner_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
    await wh.remove(hook.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Test delivery
router.post('/:id/test', requireAuth, requireRole('editor', 'admin'), async (req, res, next) => {
  try {
    const hook = await wh.findById(req.params.id);
    if (!hook || hook.owner_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
    await wh.deliver(hook, 'ping', { message: 'PaperSub.AI webhook test delivery' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
