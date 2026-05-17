'use strict';

/**
 * Idempotent migration.
 *
 *   npm run migrate
 *
 * v3 schema adds: affiliation on users, conflict-of-interest history,
 * notifications, tags, embedding cache, decision history.
 */

const { run } = require('./connection');
const logger = require('../utils/logger');

async function migrate() {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('author','reviewer','editor','admin','reader')),
      expertise TEXT,
      affiliation TEXT,                     -- institution / org for COI detection
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  // Make affiliation column work even on older DBs (best-effort ALTER).
  await run(`ALTER TABLE users ADD COLUMN affiliation TEXT`).catch(() => {});

  await run(`
    CREATE TABLE IF NOT EXISTS papers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      authors TEXT NOT NULL,
      abstract TEXT NOT NULL,
      keywords TEXT,
      tags TEXT,                            -- comma-separated, editor-curated
      file_path TEXT,
      file_text TEXT,
      ai_summary TEXT,
      ai_keywords TEXT,
      similarity_score REAL DEFAULT 0,
      ai_text_likelihood REAL DEFAULT 0,
      review_status TEXT NOT NULL DEFAULT 'pending'
        CHECK(review_status IN ('pending','under_review','accepted','rejected','revisions')),
      submission_date TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(author_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await run(`ALTER TABLE papers ADD COLUMN tags TEXT`).catch(() => {});

  await run(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paper_id INTEGER NOT NULL,
      reviewer_id INTEGER NOT NULL,
      summary TEXT,
      strengths TEXT,
      weaknesses TEXT,
      novelty_score INTEGER,
      clarity_score INTEGER,
      significance_score INTEGER,
      recommendation TEXT
        CHECK(recommendation IN ('accept','minor_revisions','major_revisions','reject') OR recommendation IS NULL),
      review_text TEXT,
      ai_assisted INTEGER DEFAULT 0,
      review_date TEXT,
      assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(paper_id) REFERENCES papers(id) ON DELETE CASCADE,
      FOREIGN KEY(reviewer_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK(kind IN ('paper','user')),
      ref_id INTEGER NOT NULL,
      vector TEXT NOT NULL,
      vocab_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(kind, ref_id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS ai_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      paper_id INTEGER,
      action TEXT NOT NULL,
      provider TEXT NOT NULL,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await run(`ALTER TABLE ai_audit ADD COLUMN paper_id INTEGER`).catch(() => {});

  await run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      link TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS coauthorships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_a_id INTEGER NOT NULL,
      user_b_id INTEGER NOT NULL,
      year INTEGER,
      FOREIGN KEY(user_a_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(user_b_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_a_id, user_b_id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paper_id INTEGER NOT NULL,
      editor_id INTEGER NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(paper_id) REFERENCES papers(id) ON DELETE CASCADE,
      FOREIGN KEY(editor_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await run('CREATE INDEX IF NOT EXISTS idx_papers_author ON papers(author_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_papers_status ON papers(review_status)');
  await run('CREATE INDEX IF NOT EXISTS idx_reviews_paper ON reviews(paper_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_reviews_reviewer ON reviews(reviewer_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_embeddings_ref ON embeddings(kind, ref_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at)');
  await run('CREATE INDEX IF NOT EXISTS idx_decisions_paper ON decisions(paper_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_audit_paper ON ai_audit(paper_id)');

  logger.info('Migration complete');
}

if (require.main === module) {
  migrate().then(() => process.exit(0)).catch((err) => { logger.error({ err }, 'Migration failed'); process.exit(1); });
}

module.exports = migrate;
