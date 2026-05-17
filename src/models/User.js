'use strict';

const bcrypt = require('bcrypt');
const { run, get, all } = require('../db/connection');

const ROLES = ['author', 'reviewer', 'editor', 'admin', 'reader'];

async function create({ username, email, password, role, expertise = '', affiliation = '' }) {
  if (!ROLES.includes(role)) throw new Error(`Invalid role: ${role}`);
  const hash = await bcrypt.hash(password, 10);
  const result = await run(
    'INSERT INTO users (username, email, password_hash, role, expertise, affiliation) VALUES (?,?,?,?,?,?)',
    [username, email || null, hash, role, expertise, affiliation]
  );
  return findById(result.lastID);
}

function findById(id) {
  return get('SELECT id, username, email, role, expertise, affiliation, created_at FROM users WHERE id = ?', [id]);
}

function findByUsername(username) {
  return get('SELECT * FROM users WHERE username = ?', [username]);
}

function listReviewers() {
  return all("SELECT id, username, email, expertise, affiliation FROM users WHERE role = 'reviewer' ORDER BY username");
}

function listByRole(role) {
  return all('SELECT id, username, email, role, expertise, affiliation FROM users WHERE role = ? ORDER BY username', [role]);
}

async function verifyPassword(user, plaintext) {
  if (!user || !user.password_hash) return false;
  return bcrypt.compare(plaintext, user.password_hash);
}

function updateProfile(id, { email, expertise, affiliation }) {
  return run(
    `UPDATE users SET email = COALESCE(?, email), expertise = COALESCE(?, expertise), affiliation = COALESCE(?, affiliation) WHERE id = ?`,
    [email ?? null, expertise ?? null, affiliation ?? null, id]
  );
}

module.exports = { ROLES, create, findById, findByUsername, listReviewers, listByRole, verifyPassword, updateProfile };
