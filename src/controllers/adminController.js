'use strict';

const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const ExcelJS = require('exceljs');
const Paper = require('../models/Paper');
const Review = require('../models/Review');
const User = require('../models/User');
const Track = require('../models/Track');
const analytics = require('../services/operationsAnalytics');
const audit = require('../services/auditLog');
const { all } = require('../db/connection');
const config = require('../config');
const logger = require('../utils/logger');

async function dashboard(req, res, next) {
  try {
    const papers = await Paper.listAll({ limit: 20 });
    const reviews = await Review.listAll();
    const aiUsage = await all('SELECT action, provider, COUNT(*) AS n FROM ai_audit GROUP BY action, provider ORDER BY n DESC');
    const ops = await analytics.getAdminAnalytics();
    const recentUsers = await User.listAll({ limit: 10 });
    const tracks = await Track.listAll();
    res.render('admin/dashboard', { title: 'Admin dashboard', papers, reviews, aiUsage, ops, recentUsers, tracks });
  } catch (err) { next(err); }
}

async function listUsers(req, res, next) {
  try {
    const q = (req.query.q || '').trim() || null;
    const role = req.query.role || null;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = 25;
    const offset = (page - 1) * pageSize;
    const [users, total] = await Promise.all([
      User.listAll({ limit: pageSize, offset, q, role }),
      User.countAll({ q, role }),
    ]);
    res.render('admin/users', {
      title: 'User management',
      users, q, role,
      filter: { page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) },
      roles: User.ROLES,
    });
  } catch (err) { next(err); }
}

async function updateUser(req, res, next) {
  try {
    const { userId, action, role } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.id === req.user.id && action !== 'set-role') {
      // Prevent admins from deactivating themselves
    }

    if (action === 'activate') {
      await User.setActive(userId, true);
      logger.info({ adminId: req.user.id, userId, action: 'activate_user' }, 'Admin activated user');
      await audit.log(req.user.id, 'admin.user.activate', 'user', userId, { target: user.username }, req);
    } else if (action === 'deactivate') {
      if (user.id === req.user.id) return res.status(400).json({ error: 'Cannot deactivate your own account' });
      await User.setActive(userId, false);
      logger.info({ adminId: req.user.id, userId, action: 'deactivate_user' }, 'Admin deactivated user');
      await audit.log(req.user.id, 'admin.user.deactivate', 'user', userId, { target: user.username }, req);
    } else if (action === 'set-role') {
      if (!role || !User.ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
      if (user.id === req.user.id && role !== 'admin') return res.status(400).json({ error: 'Cannot remove admin role from yourself' });
      await User.setRole(userId, role);
      logger.info({ adminId: req.user.id, userId, newRole: role }, 'Admin changed user role');
      await audit.log(req.user.id, 'admin.user.set_role', 'user', userId, { target: user.username, role }, req);
    } else {
      return res.status(400).json({ error: 'Unknown action' });
    }

    // Respond with JSON for AJAX or redirect for form POST
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.json({ ok: true });
    }
    res.redirect('/admin/users');
  } catch (err) { next(err); }
}

// ── Track management ──────────────────────────────────────────────────────────

async function listTracks(req, res, next) {
  try {
    const tracks = await Track.listAll();
    res.render('admin/tracks', { title: 'Conference tracks', tracks });
  } catch (err) { next(err); }
}

async function createTrack(req, res, next) {
  try {
    const { name, description, submissionDeadline, reviewDeadline } = req.body;
    if (!name || !name.trim()) return res.redirect('/admin/tracks?error=' + encodeURIComponent('Track name is required'));
    await Track.create({ name: name.trim(), description, submissionDeadline: submissionDeadline || null, reviewDeadline: reviewDeadline || null, createdBy: req.user.id });
    res.redirect('/admin/tracks');
  } catch (err) { next(err); }
}

async function updateTrack(req, res, next) {
  try {
    const { id } = req.params;
    const { name, description, submissionDeadline, reviewDeadline, isActive } = req.body;
    await Track.update(id, { name, description, submissionDeadline: submissionDeadline || null, reviewDeadline: reviewDeadline || null, isActive: isActive !== undefined ? (isActive === '1' ? 1 : 0) : undefined });
    res.redirect('/admin/tracks');
  } catch (err) { next(err); }
}

async function deleteTrack(req, res, next) {
  try {
    await Track.remove(req.params.id);
    res.redirect('/admin/tracks');
  } catch (err) { next(err); }
}

// ── Export ────────────────────────────────────────────────────────────────────

async function exportXlsx(req, res, next) {
  try {
    const rows = await all(`
      SELECT p.id, p.title, p.authors, u.username AS contact_author,
             p.abstract, p.keywords, p.review_status,
             p.similarity_score, p.ai_text_likelihood, p.current_version,
             p.submission_date, t.name AS track
      FROM papers p
      LEFT JOIN users u ON p.author_id = u.id
      LEFT JOIN tracks t ON p.track_id = t.id
      ORDER BY p.submission_date DESC
    `);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Papers');
    ws.columns = [
      { header: 'ID', key: 'id', width: 6 },
      { header: 'Title', key: 'title', width: 40 },
      { header: 'Authors', key: 'authors', width: 24 },
      { header: 'Contact author', key: 'contact_author', width: 18 },
      { header: 'Track', key: 'track', width: 18 },
      { header: 'Abstract', key: 'abstract', width: 60 },
      { header: 'Keywords', key: 'keywords', width: 24 },
      { header: 'Status', key: 'review_status', width: 14 },
      { header: 'Version', key: 'current_version', width: 8 },
      { header: 'Similarity', key: 'similarity_score', width: 10 },
      { header: 'AI-text likelihood', key: 'ai_text_likelihood', width: 16 },
      { header: 'Submission date', key: 'submission_date', width: 20 },
    ];
    rows.forEach((r) => ws.addRow(r));
    ws.getRow(1).font = { bold: true };

    const tmp = path.join(config.paths.root, 'data', `export-${Date.now()}.xlsx`);
    await wb.xlsx.writeFile(tmp);
    res.download(tmp, 'papers.xlsx', async () => { fs.unlink(tmp).catch(() => {}); });
  } catch (err) { next(err); }
}

async function exportCsv(req, res, next) {
  try {
    const rows = await all(`
      SELECT p.id, p.title, p.authors, u.username AS contact_author,
             p.review_status, p.similarity_score, p.ai_text_likelihood,
             p.submission_date, t.name AS track
      FROM papers p
      LEFT JOIN users u ON p.author_id = u.id
      LEFT JOIN tracks t ON p.track_id = t.id
      ORDER BY p.submission_date DESC
    `);
    const headers = ['id', 'title', 'authors', 'contact_author', 'track', 'review_status', 'similarity_score', 'ai_text_likelihood', 'submission_date'];
    const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="papers.csv"');
    res.send(csv);
  } catch (err) { next(err); }
}

// ── Audit log ─────────────────────────────────────────────────────────────────

async function auditLogView(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = 50;
    const offset = (page - 1) * pageSize;
    const filters = {
      userId: req.query.userId ? parseInt(req.query.userId, 10) : undefined,
      action: req.query.action || undefined,
      resourceType: req.query.resourceType || undefined,
    };
    const [entries, total] = await Promise.all([
      audit.list({ ...filters, limit: pageSize, offset }),
      audit.count(filters),
    ]);
    res.render('admin/audit-log', {
      title: 'Audit log',
      entries, filters,
      filter: { page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) },
    });
  } catch (err) { next(err); }
}

async function auditLogCsv(req, res, next) {
  try {
    const entries = await audit.list({ limit: 5000, offset: 0 });
    const headers = ['id', 'created_at', 'username', 'action', 'resource_type', 'resource_id', 'details', 'ip'];
    const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [headers.join(','), ...entries.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"');
    res.send(csv);
  } catch (err) { next(err); }
}

// ── Backup ────────────────────────────────────────────────────────────────────
const backupService = require('../db/backup');

async function backupView(req, res, next) {
  try {
    const backups = backupService.list();
    res.render('admin/backup', { title: 'Database backups', backups, success: req.query.success || null, error: req.query.error || null });
  } catch (err) { next(err); }
}

async function triggerBackup(req, res, next) {
  try {
    const result = await backupService.run();
    await audit.log(req.user.id, 'admin.backup.triggered', 'system', null, { path: result.path, bytes: result.size }, req);
    res.redirect('/admin/backup?success=' + encodeURIComponent(`Backup created: ${result.path} (${(result.size / 1024).toFixed(1)} KB)`));
  } catch (err) {
    res.redirect('/admin/backup?error=' + encodeURIComponent('Backup failed: ' + err.message));
  }
}

async function downloadBackup(req, res, next) {
  try {
    const { filename } = req.params;
    if (!/^backup_[\d-_T]+\.db$/.test(filename)) return res.status(400).send('Invalid filename');
    const filePath = require('path').join(backupService.BACKUP_DIR, filename);
    if (!fsSync.existsSync(filePath)) return res.status(404).send('Backup not found');
    await audit.log(req.user.id, 'admin.backup.download', 'system', null, { filename }, req);
    res.download(filePath, filename);
  } catch (err) { next(err); }
}

module.exports = { dashboard, listUsers, updateUser, listTracks, createTrack, updateTrack, deleteTrack, exportXlsx, exportCsv, auditLogView, auditLogCsv, backupView, triggerBackup, downloadBackup };
