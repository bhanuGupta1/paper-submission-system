'use strict';

const { run, get, all } = require('../db/connection');

function assign(paperId, reviewerId) {
  return run(
    'INSERT OR IGNORE INTO reviews (paper_id, reviewer_id) VALUES (?,?)',
    [paperId, reviewerId]
  );
}

function findById(id) {
  return get('SELECT * FROM reviews WHERE id = ?', [id]);
}

function findByPaperReviewer(paperId, reviewerId) {
  return get(
    'SELECT * FROM reviews WHERE paper_id = ? AND reviewer_id = ?',
    [paperId, reviewerId]
  );
}

function listByPaper(paperId) {
  return all(
    `SELECT r.*, u.username AS reviewer_username
     FROM reviews r
     JOIN users u ON u.id = r.reviewer_id
     WHERE r.paper_id = ?
     ORDER BY r.review_date DESC`,
    [paperId]
  );
}

function listAll() {
  return all('SELECT * FROM reviews ORDER BY assigned_at DESC');
}

function submit(id, fields) {
  const {
    summary,
    strengths,
    weaknesses,
    novelty_score,
    clarity_score,
    significance_score,
    recommendation,
    review_text,
    ai_assisted,
  } = fields;
  return run(
    `UPDATE reviews
     SET summary = ?, strengths = ?, weaknesses = ?,
         novelty_score = ?, clarity_score = ?, significance_score = ?,
         recommendation = ?, review_text = ?, ai_assisted = ?,
         review_date = datetime('now')
     WHERE id = ?`,
    [
      summary || null,
      strengths || null,
      weaknesses || null,
      novelty_score || null,
      clarity_score || null,
      significance_score || null,
      recommendation || null,
      review_text || null,
      ai_assisted ? 1 : 0,
      id,
    ]
  );
}

module.exports = { assign, findById, findByPaperReviewer, listByPaper, listAll, submit };
