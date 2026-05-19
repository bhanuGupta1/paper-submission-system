'use strict';

const { run, get, all } = require('../db/connection');

function create({ authorId, title, authors, abstract, keywords, filePath, fileText, tags }) {
  return run(
    `INSERT INTO papers (author_id, title, authors, abstract, keywords, file_path, file_text, tags)
     VALUES (?,?,?,?,?,?,?,?)`,
    [authorId, title, authors, abstract, keywords || null, filePath || null, fileText || null, tags || null]
  );
}

function findById(id) {
  return get('SELECT * FROM papers WHERE id = ?', [id]);
}

function listByAuthor(authorId, { limit = 50, offset = 0 } = {}) {
  return all(
    `SELECT p.*, (SELECT COUNT(*) FROM reviews r WHERE r.paper_id = p.id) AS review_count
     FROM papers p WHERE p.author_id = ?
     ORDER BY p.submission_date DESC LIMIT ? OFFSET ?`,
    [authorId, limit, offset]
  );
}

function listAll({ limit = 100, offset = 0, status = null, q = null } = {}) {
  const where = [];
  const params = [];
  if (status) { where.push('p.review_status = ?'); params.push(status); }
  if (q) { where.push('(p.title LIKE ? OR p.abstract LIKE ? OR p.tags LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const sql = `SELECT p.*, u.username AS author_username
     FROM papers p JOIN users u ON u.id = p.author_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY p.submission_date DESC LIMIT ? OFFSET ?`;
  return all(sql, [...params, limit, offset]);
}

function countAll({ status = null, q = null } = {}) {
  const where = [];
  const params = [];
  if (status) { where.push('review_status = ?'); params.push(status); }
  if (q) { where.push('(title LIKE ? OR abstract LIKE ? OR tags LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const sql = `SELECT COUNT(*) AS n FROM papers ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
  return get(sql, params).then((r) => r ? r.n : 0);
}

function listForReviewer(reviewerId, { limit = 100, offset = 0 } = {}) {
  return all(
    `SELECT p.*, r.id AS review_id, r.recommendation, r.review_date, r.assigned_at, r.ai_assisted
     FROM papers p JOIN reviews r ON r.paper_id = p.id
     WHERE r.reviewer_id = ? ORDER BY r.assigned_at DESC LIMIT ? OFFSET ?`,
    [reviewerId, limit, offset]
  );
}

function updateAiMetadata(id, { aiSummary, aiKeywords, similarityScore, aiTextLikelihood }) {
  return run(
    `UPDATE papers
     SET ai_summary = COALESCE(?, ai_summary),
         ai_keywords = COALESCE(?, ai_keywords),
         similarity_score = COALESCE(?, similarity_score),
         ai_text_likelihood = COALESCE(?, ai_text_likelihood)
     WHERE id = ?`,
    [aiSummary ?? null, aiKeywords ?? null,
     typeof similarityScore === 'number' ? similarityScore : null,
     typeof aiTextLikelihood === 'number' ? aiTextLikelihood : null, id]
  );
}

function updateStatus(id, status) {
  return run('UPDATE papers SET review_status = ? WHERE id = ?', [status, id]);
}

function updateTags(id, tags) {
  return run('UPDATE papers SET tags = ? WHERE id = ?', [tags || null, id]);
}

function recordDecision({ paperId, editorId, fromStatus, toStatus, note }) {
  return run(
    `INSERT INTO decisions (paper_id, editor_id, from_status, to_status, note) VALUES (?,?,?,?,?)`,
    [paperId, editorId, fromStatus || null, toStatus, note || null]
  );
}

function decisionsForPaper(paperId) {
  return all(
    `SELECT d.*, u.username AS editor_username
     FROM decisions d JOIN users u ON u.id = d.editor_id
     WHERE d.paper_id = ? ORDER BY d.created_at DESC`, [paperId]
  );
}

function authorStats(authorId) {
  return get(
    `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN review_status = 'accepted' THEN 1 ELSE 0 END) AS accepted,
        SUM(CASE WHEN review_status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
        SUM(CASE WHEN review_status = 'pending' OR review_status = 'under_review' THEN 1 ELSE 0 END) AS in_review,
        SUM(CASE WHEN review_status = 'revisions' THEN 1 ELSE 0 END) AS revisions
     FROM papers WHERE author_id = ?`, [authorId]
  );
}

module.exports = {
  create, findById, listByAuthor, listAll, countAll, listForReviewer,
  updateAiMetadata, updateStatus, updateTags, recordDecision, decisionsForPaper, authorStats,
};
