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
  return get('SELECT id, username, email, role, expertise, affiliation, email_verified, is_active, last_login, created_at FROM users WHERE id = ?', [id]);
}

function findByUsername(username) {
  return get('SELECT * FROM users WHERE username = ?', [username]);
}

function findByEmail(email) {
  return get('SELECT * FROM users WHERE email = ?', [email]);
}

function listReviewers() {
  return all("SELECT id, username, email, expertise, affiliation FROM users WHERE role = 'reviewer' AND is_active = 1 ORDER BY username");
}

function listByRole(role) {
  return all('SELECT id, username, email, role, expertise, affiliation, is_active FROM users WHERE role = ? ORDER BY username', [role]);
}

function listAll({ limit = 50, offset = 0, q = null, role = null } = {}) {
  const filters = [];
  const params = [];
  if (q) {
    filters.push('(username LIKE ? OR email LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (role) { filters.push('role = ?'); params.push(role); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  params.push(limit, offset);
  return all(`SELECT id, username, email, role, expertise, affiliation, email_verified, is_active, last_login, created_at FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, params);
}

function countAll({ q = null, role = null } = {}) {
  const filters = [];
  const params = [];
  if (q) { filters.push('(username LIKE ? OR email LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  if (role) { filters.push('role = ?'); params.push(role); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  return get(`SELECT COUNT(*) AS n FROM users ${where}`, params).then((r) => r.n);
}

async function verifyPassword(user, plaintext) {
  if (!user || !user.password_hash) return false;
  return bcrypt.compare(plaintext, user.password_hash);
}

function updateProfile(id, { email, expertise, affiliation }) {
  return run(
    'UPDATE users SET email = COALESCE(?, email), expertise = COALESCE(?, expertise), affiliation = COALESCE(?, affiliation) WHERE id = ?',
    [email ?? null, expertise ?? null, affiliation ?? null, id]
  );
}

function markEmailVerified(id) {
  return run('UPDATE users SET email_verified = 1 WHERE id = ?', [id]);
}

function setPassword(id, hash) {
  return run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, id]);
}

function setActive(id, isActive) {
  return run('UPDATE users SET is_active = ? WHERE id = ?', [isActive ? 1 : 0, id]);
}

function setRole(id, role) {
  if (!ROLES.includes(role)) throw new Error(`Invalid role: ${role}`);
  return run('UPDATE users SET role = ? WHERE id = ?', [role, id]);
}

function touchLastLogin(id) {
  return run('UPDATE users SET last_login = datetime(\'now\') WHERE id = ?', [id]);
}

module.exports = {
  ROLES, create, findById, findByUsername, findByEmail,
  listReviewers, listByRole, listAll, countAll,
  verifyPassword, updateProfile,
  markEmailVerified, setPassword, setActive, setRole, touchLastLogin,
};
