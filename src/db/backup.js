'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');
const { db } = require('./connection');

const BACKUP_DIR = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.join(config.paths.root, 'data', 'backups');

const MAX_BACKUPS = parseInt(process.env.BACKUP_MAX_COUNT, 10) || 14;

function ensureDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function backupFilename() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  return path.join(BACKUP_DIR, `backup_${ts}.db`);
}

async function run() {
  ensureDir();
  const dest = backupFilename();
  await new Promise((resolve, reject) => {
    db.backup(dest, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
  const stat = fs.statSync(dest);
  logger.info({ dest, bytes: stat.size }, 'SQLite backup completed');
  pruneOldBackups();
  return { path: dest, size: stat.size, createdAt: new Date().toISOString() };
}

function pruneOldBackups() {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('backup_') && f.endsWith('.db'))
      .map((f) => ({ name: f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    files.slice(MAX_BACKUPS).forEach(({ name }) => {
      fs.unlinkSync(path.join(BACKUP_DIR, name));
      logger.info({ name }, 'Pruned old backup');
    });
  } catch (err) {
    logger.warn({ err }, 'Failed to prune old backups');
  }
}

function list() {
  ensureDir();
  return fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('backup_') && f.endsWith('.db'))
    .map((f) => {
      const stat = fs.statSync(path.join(BACKUP_DIR, f));
      return { name: f, size: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 20);
}

module.exports = { run, list, BACKUP_DIR };
