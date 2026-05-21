'use strict';

const path = require('path');
const Paper = require('../models/Paper');
const { all, get } = require('../db/connection');

async function feed(req, res, next) {
  try {
    const q = (req.query.q || '').trim();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = 18;
    const offset = (page - 1) * pageSize;

    let papers, total;
    if (q) {
      // Try FTS5 first, fall back to LIKE
      try {
        const ftsQ = q.split(/\s+/).map((w) => `"${w.replace(/"/g, '')}"`).join(' OR ');
        papers = await all(
          `SELECT p.id, p.title, p.authors, p.abstract, p.keywords, p.ai_summary, p.submission_date, p.tags,
                  u.username AS author_username
           FROM papers_fts fts
           JOIN papers p ON p.id = fts.rowid
           JOIN users u ON p.author_id = u.id
           WHERE papers_fts MATCH ? AND p.review_status = 'accepted'
           ORDER BY rank
           LIMIT ? OFFSET ?`,
          [ftsQ, pageSize, offset]
        );
        const row = await get(
          `SELECT COUNT(*) AS n FROM papers_fts fts JOIN papers p ON p.id = fts.rowid WHERE papers_fts MATCH ? AND p.review_status = 'accepted'`,
          [ftsQ]
        );
        total = row ? row.n : papers.length;
      } catch (_) {
        papers = await all(
          `SELECT p.id, p.title, p.authors, p.abstract, p.keywords, p.ai_summary, p.submission_date, p.tags,
                  u.username AS author_username
           FROM papers p JOIN users u ON p.author_id = u.id
           WHERE p.review_status = 'accepted'
             AND (p.title LIKE ? OR p.abstract LIKE ? OR p.keywords LIKE ? OR p.authors LIKE ?)
           ORDER BY p.submission_date DESC LIMIT ? OFFSET ?`,
          [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, pageSize, offset]
        );
        total = papers.length;
      }
    } else {
      const countRow = await get(`SELECT COUNT(*) AS n FROM papers WHERE review_status = 'accepted'`);
      total = countRow ? countRow.n : 0;
      papers = await all(
        `SELECT p.id, p.title, p.authors, p.abstract, p.keywords, p.ai_summary, p.submission_date, p.tags,
                u.username AS author_username
         FROM papers p JOIN users u ON p.author_id = u.id
         WHERE p.review_status = 'accepted'
         ORDER BY p.submission_date DESC LIMIT ? OFFSET ?`,
        [pageSize, offset]
      );
    }

    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    res.render('reader/feed', { title: 'Published articles', papers, q, page, pageSize, total, pageCount });
  } catch (err) {
    next(err);
  }
}

async function paperDetail(req, res, next) {
  try {
    const paper = await get(
      `SELECT p.*, u.username AS author_username, u.affiliation AS author_affiliation
       FROM papers p JOIN users u ON p.author_id = u.id
       WHERE p.id = ? AND p.review_status = 'accepted'`,
      [req.params.id]
    );
    if (!paper) return res.status(404).render('error', { title: 'Not Found', message: 'Article not available.' });
    res.render('reader/paper', { title: paper.title, paper });
  } catch (err) { next(err); }
}

function buildBibtex(paper) {
  const year = new Date(paper.submission_date).getFullYear();
  const key = `${(paper.authors || '').split(/[,&]/)[0].trim().replace(/\s+/g, '')}_${year}`;
  return `@article{${key},
  title  = {${paper.title}},
  author = {${paper.authors}},
  year   = {${year}},
  journal = {PaperSub.AI},
  note   = {\\url{${process.env.APP_URL || 'http://localhost:3000'}/reader/papers/${paper.id}}}
}`;
}

function buildApa(paper) {
  const year = new Date(paper.submission_date).getFullYear();
  return `${paper.authors} (${year}). ${paper.title}. PaperSub.AI. Retrieved from ${process.env.APP_URL || 'http://localhost:3000'}/reader/papers/${paper.id}`;
}

async function citationExport(req, res, next) {
  try {
    const paper = await get(
      `SELECT p.* FROM papers p WHERE p.id = ? AND p.review_status = 'accepted'`,
      [req.params.id]
    );
    if (!paper) return res.status(404).json({ error: 'Not found' });
    const fmt = req.query.format || 'bibtex';
    if (fmt === 'bibtex') {
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', `attachment; filename="citation.bib"`);
      return res.send(buildBibtex(paper));
    }
    if (fmt === 'apa') {
      return res.json({ citation: buildApa(paper) });
    }
    res.status(400).json({ error: 'Unknown format. Use ?format=bibtex or ?format=apa' });
  } catch (err) { next(err); }
}

async function downloadAccepted(req, res, next) {
  try {
    const paper = await Paper.findById(req.params.id);
    if (!paper || paper.review_status !== 'accepted' || !paper.file_path) {
      return res.status(404).render('error', { title: 'Not Found', message: 'Article not available.' });
    }
    res.download(paper.file_path, path.basename(paper.file_path));
  } catch (err) { next(err); }
}

module.exports = { feed, paperDetail, citationExport, downloadAccepted };
