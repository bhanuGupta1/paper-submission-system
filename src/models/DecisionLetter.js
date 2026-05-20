'use strict';

const { run, get, all } = require('../db/connection');

function create({ paperId, decisionId, editorId, subject, body }) {
  return run(
    'INSERT INTO decision_letters (paper_id, decision_id, editor_id, subject, body) VALUES (?,?,?,?,?)',
    [paperId, decisionId, editorId, subject, body]
  );
}

function findByPaper(paperId) {
  return all(
    `SELECT dl.*, u.username AS editor_username FROM decision_letters dl
     JOIN users u ON u.id = dl.editor_id
     WHERE dl.paper_id = ? ORDER BY dl.created_at DESC`,
    [paperId]
  );
}

function findById(id) {
  return get('SELECT * FROM decision_letters WHERE id = ?', [id]);
}

function markSent(id) {
  return run('UPDATE decision_letters SET sent_at = datetime(\'now\') WHERE id = ?', [id]);
}

module.exports = { create, findByPaper, findById, markSent };
