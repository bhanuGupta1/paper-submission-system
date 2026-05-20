'use strict';

const { run, get, all } = require('../db/connection');

function create({ name, description, submissionDeadline, reviewDeadline, createdBy }) {
  return run(
    'INSERT INTO tracks (name, description, submission_deadline, review_deadline, created_by) VALUES (?,?,?,?,?)',
    [name, description || null, submissionDeadline || null, reviewDeadline || null, createdBy || null]
  );
}

function listActive() {
  return all('SELECT * FROM tracks WHERE is_active = 1 ORDER BY name');
}

function listAll() {
  return all('SELECT t.*, u.username AS created_by_username FROM tracks t LEFT JOIN users u ON u.id = t.created_by ORDER BY t.created_at DESC');
}

function findById(id) {
  return get('SELECT * FROM tracks WHERE id = ?', [id]);
}

function update(id, { name, description, submissionDeadline, reviewDeadline, isActive }) {
  return run(
    'UPDATE tracks SET name=COALESCE(?,name), description=COALESCE(?,description), submission_deadline=COALESCE(?,submission_deadline), review_deadline=COALESCE(?,review_deadline), is_active=COALESCE(?,is_active) WHERE id=?',
    [name ?? null, description ?? null, submissionDeadline ?? null, reviewDeadline ?? null, isActive ?? null, id]
  );
}

function remove(id) {
  return run('DELETE FROM tracks WHERE id = ?', [id]);
}

module.exports = { create, listActive, listAll, findById, update, remove };
