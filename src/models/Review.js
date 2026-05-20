'use strict';

const { run, get, all } = require('../db/connection');

function assign(paperId, reviewerId, deadline = null) {
  return run(
    'INSERT OR IGNORE INTO reviews (paper_id, reviewer_id, deadline) VALUES (?,?,?)',
    [paperId, reviewerId, deadline]
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

function listByReviewer(reviewerId, { includeDeclined = false } = {}) {
  const extra = includeDeclined ? '' : 'AND r.declined_at IS NULL';
  return all(
    `SELECT r.*, p.title AS paper_title, p.abstract, p.keywords, p.review_status
     FROM reviews r JOIN papers p ON p.id = r.paper_id
     WHERE r.reviewer_id = ? ${extra}
     ORDER BY r.assigned_at DESC`,
    [reviewerId]
  );
}

function decline(id, reason) {
  return run(
    'UPDATE reviews SET declined_at = datetime(\'now\'), decline_reason = ? WHERE id = ?',
    [reason || null, id]
  );
}

function setDeadline(id, deadline) {
  return run('UPDATE reviews SET deadline = ? WHERE id = ?', [deadline, id]);
}

function markReminderSent(id) {
  return run('UPDATE reviews SET reminder_sent = 1 WHERE id = ?', [id]);
}

function listOverdue() {
  return all(
    `SELECT r.*, p.title AS paper_title, u.email AS reviewer_email, u.username AS reviewer_username
     FROM reviews r
     JOIN papers p ON p.id = r.paper_id
     JOIN users u ON u.id = r.reviewer_id
     WHERE r.review_date IS NULL AND r.declined_at IS NULL
       AND r.deadline IS NOT NULL AND r.deadline < datetime('now')
     ORDER BY r.deadline ASC`
  );
}

function declareCoi(paperId, reviewerId, reason) {
  return run(
    'INSERT OR REPLACE INTO coi_declarations (paper_id, reviewer_id, reason) VALUES (?,?,?)',
    [paperId, reviewerId, reason]
  );
}

function coiForPaper(paperId) {
  return all(
    `SELECT cd.*, u.username FROM coi_declarations cd
     JOIN users u ON u.id = cd.reviewer_id
     WHERE cd.paper_id = ? ORDER BY cd.declared_at DESC`,
    [paperId]
  );
}

module.exports = {
  assign, findById, findByPaperReviewer, listByPaper, listByReviewer, listAll, listOverdue,
  submit, decline, setDeadline, markReminderSent,
  declareCoi, coiForPaper,
};
