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
  // Best-effort ALTER TABLE for columns added in later migrations.
  await run(`ALTER TABLE users ADD COLUMN affiliation TEXT`).catch(() => {});
  await run(`ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1`).catch(() => {});
  await run(`ALTER TABLE users ADD COLUMN last_login TEXT`).catch(() => {});
  await run(`ALTER TABLE users ADD COLUMN oauth_provider TEXT`).catch(() => {});
  await run(`ALTER TABLE users ADD COLUMN oauth_id TEXT`).catch(() => {});
  // Allow OAuth users to have an empty password_hash (they sign in via provider only).
  // The CHECK(password_hash NOT NULL) is on the original CREATE TABLE, so new rows are fine
  // with '' as a hash; existing tables won't break.

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

  // v4: email verification, password reset, JWT refresh tokens
  await run(`ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1`).catch(() => {});
  await run(`ALTER TABLE users ADD COLUMN last_login TEXT`).catch(() => {});

  await run(`
    CREATE TABLE IF NOT EXISTS email_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK(kind IN ('verify','reset')),
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      family TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // v4: paper versioning / revision history
  await run(`
    CREATE TABLE IF NOT EXISTS paper_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paper_id INTEGER NOT NULL,
      version_number INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      abstract TEXT NOT NULL,
      authors TEXT NOT NULL,
      keywords TEXT,
      file_path TEXT,
      file_text TEXT,
      change_note TEXT,
      submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(paper_id) REFERENCES papers(id) ON DELETE CASCADE
    )
  `);
  await run(`ALTER TABLE papers ADD COLUMN current_version INTEGER NOT NULL DEFAULT 1`).catch(() => {});
  await run(`ALTER TABLE papers ADD COLUMN revision_note TEXT`).catch(() => {});

  // v4: review deadlines
  await run(`ALTER TABLE reviews ADD COLUMN deadline TEXT`).catch(() => {});
  await run(`ALTER TABLE reviews ADD COLUMN reminder_sent INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE reviews ADD COLUMN declined_at TEXT`).catch(() => {});
  await run(`ALTER TABLE reviews ADD COLUMN decline_reason TEXT`).catch(() => {});

  // v4: COI declarations by reviewers
  await run(`
    CREATE TABLE IF NOT EXISTS coi_declarations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paper_id INTEGER NOT NULL,
      reviewer_id INTEGER NOT NULL,
      reason TEXT NOT NULL,
      declared_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(paper_id) REFERENCES papers(id) ON DELETE CASCADE,
      FOREIGN KEY(reviewer_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(paper_id, reviewer_id)
    )
  `);

  // v4: editor-reviewer discussion threads
  await run(`
    CREATE TABLE IF NOT EXISTS discussions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paper_id INTEGER NOT NULL,
      author_id INTEGER NOT NULL,
      parent_id INTEGER,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(paper_id) REFERENCES papers(id) ON DELETE CASCADE,
      FOREIGN KEY(author_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(parent_id) REFERENCES discussions(id) ON DELETE SET NULL
    )
  `);

  // v4: decision letters
  await run(`
    CREATE TABLE IF NOT EXISTS decision_letters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paper_id INTEGER NOT NULL,
      decision_id INTEGER NOT NULL,
      editor_id INTEGER NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      sent_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(paper_id) REFERENCES papers(id) ON DELETE CASCADE,
      FOREIGN KEY(decision_id) REFERENCES decisions(id) ON DELETE CASCADE,
      FOREIGN KEY(editor_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // v4: conference tracks
  await run(`
    CREATE TABLE IF NOT EXISTS tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      submission_deadline TEXT,
      review_deadline TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);
  await run(`ALTER TABLE papers ADD COLUMN track_id INTEGER REFERENCES tracks(id) ON DELETE SET NULL`).catch(() => {});

  await run('CREATE INDEX IF NOT EXISTS idx_papers_author ON papers(author_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_papers_status ON papers(review_status)');
  await run('CREATE INDEX IF NOT EXISTS idx_reviews_paper ON reviews(paper_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_reviews_reviewer ON reviews(reviewer_id)');
  await run('CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_unique_assignment ON reviews(paper_id, reviewer_id)').catch(() => {});
  await run('CREATE INDEX IF NOT EXISTS idx_embeddings_ref ON embeddings(kind, ref_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at)');
  await run('CREATE INDEX IF NOT EXISTS idx_decisions_paper ON decisions(paper_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_audit_paper ON ai_audit(paper_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_email_tokens_user ON email_tokens(user_id, kind)');
  await run('CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_paper_versions_paper ON paper_versions(paper_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_discussions_paper ON discussions(paper_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_coi_declarations_paper ON coi_declarations(paper_id)');

  // v5: outgoing webhooks (Zapier, custom integrations)
  await run(`
    CREATE TABLE IF NOT EXISTS webhooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      events TEXT NOT NULL DEFAULT 'submission,decision,review',
      secret TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_delivery_at TEXT,
      last_delivery_status INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await run('CREATE INDEX IF NOT EXISTS idx_webhooks_owner ON webhooks(owner_id)');

  logger.info('Migration complete (v5)');
}

if (require.main === module) {
  migrate().then(() => process.exit(0)).catch((err) => { logger.error({ err }, 'Migration failed'); process.exit(1); });
}

module.exports = migrate;
