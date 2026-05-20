'use strict';

const { run, get, all } = require('../db/connection');

function post({ paperId, authorId, message, parentId }) {
  return run(
    'INSERT INTO discussions (paper_id, author_id, message, parent_id) VALUES (?,?,?,?)',
    [paperId, authorId, message, parentId || null]
  );
}

function listByPaper(paperId) {
  return all(
    `SELECT d.*, u.username, u.role FROM discussions d
     JOIN users u ON u.id = d.author_id
     WHERE d.paper_id = ? ORDER BY d.created_at ASC`,
    [paperId]
  );
}

module.exports = { post, listByPaper };
