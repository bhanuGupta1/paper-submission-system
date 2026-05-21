'use strict';

/**
 * Public REST API — /api/v1/...
 *
 * Authenticated via API key (Authorization: Bearer psa_... or ?api_key=...)
 *
 * Endpoints:
 *   GET  /api/v1/papers          — list accepted papers (paginated, searchable)
 *   GET  /api/v1/papers/:id      — get single accepted paper
 *   GET  /api/v1/papers/:id/cite — BibTeX citation
 *   GET  /api/v1/status          — API health + caller identity
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireApiKey } = require('../middleware/apiKeyAuth');
const { all, get } = require('../db/connection');

const router = express.Router();
router.use(express.json({ limit: '32kb' }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — limit: 100 per 15 minutes' },
  keyGenerator: (req) => req.headers.authorization || req.query.api_key || req.ip,
});
router.use(apiLimiter);

// API health check
router.get('/status', requireApiKey(), (req, res) => {
  res.json({ ok: true, user: req.apiUser.username, role: req.apiUser.role, scopes: req.apiKey.scopes });
});

// List accepted papers
router.get('/papers', requireApiKey('read:papers'), async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    let papers;
    if (q) {
      try {
        const ftsQ = q.split(/\s+/).map((w) => `"${w.replace(/"/g, '')}"`).join(' OR ');
        papers = await all(
          `SELECT p.id, p.title, p.authors, p.abstract, p.keywords, p.ai_summary, p.submission_date,
                  u.username AS author_username
           FROM papers_fts fts
           JOIN papers p ON p.id = fts.rowid
           JOIN users u ON p.author_id = u.id
           WHERE papers_fts MATCH ? AND p.review_status = 'accepted'
           ORDER BY rank LIMIT ? OFFSET ?`,
          [ftsQ, limit, offset]
        );
      } catch (_) {
        papers = await all(
          `SELECT p.id, p.title, p.authors, p.abstract, p.keywords, p.ai_summary, p.submission_date,
                  u.username AS author_username
           FROM papers p JOIN users u ON p.author_id = u.id
           WHERE p.review_status = 'accepted'
             AND (p.title LIKE ? OR p.abstract LIKE ? OR p.keywords LIKE ?)
           ORDER BY p.submission_date DESC LIMIT ? OFFSET ?`,
          [`%${q}%`, `%${q}%`, `%${q}%`, limit, offset]
        );
      }
    } else {
      papers = await all(
        `SELECT p.id, p.title, p.authors, p.abstract, p.keywords, p.ai_summary, p.submission_date,
                u.username AS author_username
         FROM papers p JOIN users u ON p.author_id = u.id
         WHERE p.review_status = 'accepted'
         ORDER BY p.submission_date DESC LIMIT ? OFFSET ?`,
        [limit, offset]
      );
    }

    const countRow = q
      ? await get(`SELECT COUNT(DISTINCT p.id) AS n FROM papers p WHERE p.review_status = 'accepted' AND (p.title LIKE ? OR p.abstract LIKE ? OR p.keywords LIKE ?)`, [`%${q}%`, `%${q}%`, `%${q}%`])
      : await get(`SELECT COUNT(*) AS n FROM papers WHERE review_status = 'accepted'`);

    res.json({ data: papers, meta: { page, limit, total: countRow ? countRow.n : 0 } });
  } catch (err) { next(err); }
});

// Single paper detail
router.get('/papers/:id', requireApiKey('read:papers'), async (req, res, next) => {
  try {
    const paper = await get(
      `SELECT p.id, p.title, p.authors, p.abstract, p.keywords, p.ai_summary, p.submission_date, p.tags,
              u.username AS author_username, u.affiliation AS author_affiliation
       FROM papers p JOIN users u ON p.author_id = u.id
       WHERE p.id = ? AND p.review_status = 'accepted'`,
      [req.params.id]
    );
    if (!paper) return res.status(404).json({ error: 'Not found' });
    res.json({ data: paper });
  } catch (err) { next(err); }
});

// BibTeX citation
router.get('/papers/:id/cite', requireApiKey('read:papers'), async (req, res, next) => {
  try {
    const paper = await get('SELECT * FROM papers WHERE id = ? AND review_status = ?', [req.params.id, 'accepted']);
    if (!paper) return res.status(404).json({ error: 'Not found' });
    const year = new Date(paper.submission_date).getFullYear();
    const key = `${(paper.authors || '').split(/[,&]/)[0].trim().replace(/\s+/g, '')}_${year}`;
    const bib = `@article{${key},\n  title  = {${paper.title}},\n  author = {${paper.authors}},\n  year   = {${year}},\n  journal = {PaperSub.AI}\n}`;
    res.setHeader('Content-Type', 'text/plain');
    res.send(bib);
  } catch (err) { next(err); }
});

module.exports = router;
