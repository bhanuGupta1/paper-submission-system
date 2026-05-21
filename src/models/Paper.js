'use strict';

const { run, get, all } = require('../db/connection');

async function create({ authorId, title, authors, abstract, keywords, filePath, fileText, tags, trackId }) {
  const result = await run(
    'INSERT INTO papers (author_id, title, authors, abstract, keywords, file_path, file_text, tags, track_id) VALUES (?,?,?,?,?,?,?,?,?)',
    [authorId, title, authors, abstract, keywords || null, filePath || null, fileText || null, tags || null, trackId || null]
  );
  const paper = await findById(result.lastID);
  // snapshot version 1
  await run(
    'INSERT INTO paper_versions (paper_id, version_number, title, abstract, authors, keywords, file_path, file_text) VALUES (?,1,?,?,?,?,?,?)',
    [paper.id, title, abstract, authors, keywords || null, filePath || null, fileText || null]
  );
  return paper;
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

async function submitRevision({ paperId, title, abstract, authors, keywords, filePath, fileText, changeNote }) {
  const paper = await findById(paperId);
  if (!paper) throw new Error('Paper not found');
  const newVersion = (paper.current_version || 1) + 1;
  await run(
    'INSERT INTO paper_versions (paper_id, version_number, title, abstract, authors, keywords, file_path, file_text, change_note) VALUES (?,?,?,?,?,?,?,?,?)',
    [paperId, newVersion, title, abstract, authors, keywords || null, filePath || null, fileText || null, changeNote || null]
  );
  await run(
    'UPDATE papers SET title=?, abstract=?, authors=?, keywords=?, file_path=COALESCE(?,file_path), file_text=COALESCE(?,file_text), current_version=?, review_status=\'pending\', revision_note=? WHERE id=?',
    [title, abstract, authors, keywords || null, filePath || null, fileText || null, newVersion, changeNote || null, paperId]
  );
  return findById(paperId);
}

function versionsForPaper(paperId) {
  return all('SELECT * FROM paper_versions WHERE paper_id = ? ORDER BY version_number DESC', [paperId]);
}

async function listAccepted({ limit = 50, offset = 0, q = null } = {}) {
  if (q && q.trim()) {
    // Use FTS5 for full-text search; fall back to LIKE if FTS table doesn't exist yet
    try {
      const ftsQ = q.trim().split(/\s+/).map((w) => `"${w.replace(/"/g, '')}"`).join(' OR ');
      return await all(
        `SELECT p.id, p.title, p.authors, p.abstract, p.keywords, p.tags, p.ai_summary, p.submission_date, rank
         FROM papers_fts fts JOIN papers p ON p.id = fts.rowid
         WHERE papers_fts MATCH ? AND p.review_status='accepted'
         ORDER BY rank LIMIT ? OFFSET ?`,
        [ftsQ, limit, offset]
      );
    } catch {
      // FTS table not yet populated — fall back to LIKE
      return all(
        `SELECT p.id, p.title, p.authors, p.abstract, p.keywords, p.tags, p.ai_summary, p.submission_date FROM papers p WHERE p.review_status='accepted' AND (p.title LIKE ? OR p.abstract LIKE ? OR p.keywords LIKE ? OR p.authors LIKE ?) ORDER BY p.submission_date DESC LIMIT ? OFFSET ?`,
        [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, limit, offset]
      );
    }
  }
  return all(
    `SELECT p.id, p.title, p.authors, p.abstract, p.keywords, p.tags, p.ai_summary, p.submission_date FROM papers p WHERE p.review_status='accepted' ORDER BY p.submission_date DESC LIMIT ? OFFSET ?`,
    [limit, offset]
  );
}

async function fullTextSearch({ q, status = null, limit = 50, offset = 0 } = {}) {
  if (!q || !q.trim()) return listAll({ limit, offset, status });
  try {
    const ftsQ = q.trim().split(/\s+/).map((w) => `"${w.replace(/"/g, '')}"`).join(' OR ');
    const whereStatus = status ? `AND p.review_status = ?` : '';
    const params = [ftsQ, ...(status ? [status] : []), limit, offset];
    return await all(
      `SELECT p.*, u.username AS author_username, rank
       FROM papers_fts fts JOIN papers p ON p.id = fts.rowid JOIN users u ON u.id = p.author_id
       WHERE papers_fts MATCH ? ${whereStatus}
       ORDER BY rank LIMIT ? OFFSET ?`,
      params
    );
  } catch {
    return listAll({ limit, offset, status, q });
  }
}

module.exports = {
  create, findById, listByAuthor, listAll, countAll, listForReviewer, listAccepted, fullTextSearch,
  updateAiMetadata, updateStatus, updateTags, recordDecision, decisionsForPaper, authorStats,
  submitRevision, versionsForPaper,
};
