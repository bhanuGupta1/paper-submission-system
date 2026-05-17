'use strict';

/**
 * Public reader feed.
 *
 * Anyone can read accepted papers - no account required. This is the
 * "published journal" view, ported from the original course project.
 * Only papers with status 'accepted' are exposed; nothing else leaks.
 *
 * The download endpoint is intentionally restricted to accepted
 * manuscripts so unpublished work is never publicly downloadable.
 */

const path = require('path');
const Paper = require('../models/Paper');
const { all } = require('../db/connection');

async function feed(req, res, next) {
  try {
    const q = (req.query.q || '').trim();
    let papers;
    if (q) {
      papers = await all(
        `SELECT p.id, p.title, p.authors, p.abstract, p.keywords, p.ai_summary, p.submission_date,
                u.username AS author_username
         FROM papers p
         JOIN users u ON p.author_id = u.id
         WHERE p.review_status = 'accepted'
           AND (p.title LIKE ? OR p.abstract LIKE ? OR p.keywords LIKE ?)
         ORDER BY p.submission_date DESC`,
        [`%${q}%`, `%${q}%`, `%${q}%`]
      );
    } else {
      papers = await all(
        `SELECT p.id, p.title, p.authors, p.abstract, p.keywords, p.ai_summary, p.submission_date,
                u.username AS author_username
         FROM papers p
         JOIN users u ON p.author_id = u.id
         WHERE p.review_status = 'accepted'
         ORDER BY p.submission_date DESC`
      );
    }
    res.render('reader/feed', { title: 'Published articles', papers, q });
  } catch (err) {
    next(err);
  }
}

async function downloadAccepted(req, res, next) {
  try {
    const paper = await Paper.findById(req.params.id);
    if (!paper || paper.review_status !== 'accepted' || !paper.file_path) {
      return res.status(404).render('error', { title: 'Not Found', message: 'Article not available.' });
    }
    res.download(paper.file_path, path.basename(paper.file_path));
  } catch (err) {
    next(err);
  }
}

module.exports = { feed, downloadAccepted };
