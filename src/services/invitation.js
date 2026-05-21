'use strict';

const crypto = require('crypto');
const { run, get, all } = require('../db/connection');

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function create({ paperId, invitedBy, email }) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await run(
    'INSERT INTO reviewer_invitations (paper_id, invited_by, email, token, expires_at) VALUES (?,?,?,?,?)',
    [paperId, invitedBy, email.toLowerCase().trim(), token, expiresAt]
  );
  return token;
}

function findByToken(token) {
  return get(
    'SELECT ri.*, p.title AS paper_title, u.username AS inviter_username FROM reviewer_invitations ri JOIN papers p ON p.id = ri.paper_id JOIN users u ON u.id = ri.invited_by WHERE ri.token = ?',
    [token]
  );
}

function listForPaper(paperId) {
  return all(
    'SELECT ri.*, u.username AS inviter_username FROM reviewer_invitations ri JOIN users u ON u.id = ri.invited_by WHERE ri.paper_id = ? ORDER BY ri.created_at DESC',
    [paperId]
  );
}

async function accept(token) {
  await run('UPDATE reviewer_invitations SET accepted_at = datetime(\'now\') WHERE token = ?', [token]);
}

function isExpired(invitation) {
  return !invitation || new Date(invitation.expires_at) < new Date();
}

module.exports = { create, findByToken, listForPaper, accept, isExpired };
