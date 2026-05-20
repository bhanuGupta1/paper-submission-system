'use strict';

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const config = require('../config');
const logger = require('../utils/logger');

// Ensure the data directory exists.
const dbDir = path.dirname(config.db.path);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(config.db.path, (err) => {
  if (err) {
    logger.error({ err }, 'Failed to open SQLite database');
    process.exit(1);
  }
  logger.info({ path: config.db.path }, 'SQLite database connected');
});

// Performance & integrity pragmas.
db.serialize(() => {
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');
});

/**
 * Promise-based wrappers around the callback-style sqlite3 API.
 * Keeps controllers async/await-friendly.
 */
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function cb(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

// Transaction helper: runs fn(db) inside BEGIN/COMMIT, rolls back on error.
function withTransaction(fn) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN EXCLUSIVE', (beginErr) => {
        if (beginErr) return reject(beginErr);
        Promise.resolve()
          .then(() => fn({ run, get, all }))
          .then((result) => {
            db.run('COMMIT', (commitErr) => {
              if (commitErr) return reject(commitErr);
              resolve(result);
            });
          })
          .catch((err) => {
            db.run('ROLLBACK', () => reject(err));
          });
      });
    });
  });
}

module.exports = { db, run, get, all, withTransaction };
