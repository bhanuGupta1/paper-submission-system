'use strict';

const bcrypt = require('bcrypt');
const { run, get } = require('./connection');
const logger = require('../utils/logger');

const DEMO_PASSWORD = 'Password123!';

const users = [
  { username: 'admin',       email: 'admin@platform.org',  role: 'admin',    expertise: '', affiliation: 'Platform Operator' },
  { username: 'editor',      email: 'editor@platform.org', role: 'editor',   expertise: '', affiliation: 'Editorial Board' },
  { username: 'reader',      email: 'reader@example.com',  role: 'reader',   expertise: '', affiliation: '' },
  { username: 'alice',       email: 'alice@auckland.ac.nz', role: 'author',  expertise: 'NLP, transformers, low-resource languages', affiliation: 'University of Auckland' },
  { username: 'bob',         email: 'bob@otago.ac.nz',     role: 'author',   expertise: 'databases, time-series, query optimization', affiliation: 'University of Otago' },
  { username: 'reviewer_ml', email: 'rev_ml@vuw.ac.nz',    role: 'reviewer', expertise: 'machine learning, deep learning, neural networks, transformers, NLP', affiliation: 'Victoria University of Wellington' },
  { username: 'reviewer_db', email: 'rev_db@canterbury.ac.nz', role: 'reviewer', expertise: 'databases, distributed systems, query optimization, SQL, indexing', affiliation: 'University of Canterbury' },
  { username: 'reviewer_se', email: 'rev_se@auckland.ac.nz', role: 'reviewer', expertise: 'software engineering, testing, agile, devops, code quality', affiliation: 'University of Auckland' },
];

const samplePapers = [
  {
    username: 'alice',
    title: 'Transformer-based Sentiment Analysis on Low-Resource Languages',
    authors: 'Alice Smith, Carol Jones',
    abstract: 'We present a transformer architecture fine-tuned for sentiment classification in low-resource languages. Our approach uses transfer learning from multilingual pre-trained models combined with synthetic data augmentation. Experiments on Hindi, Swahili and Bengali show consistent F1 improvements over recurrent baselines.',
    keywords: 'NLP, transformers, sentiment analysis, low-resource',
    tags: 'NLP, ML',
  },
  {
    username: 'bob',
    title: 'Adaptive Indexing Strategies for Time-Series Workloads',
    authors: 'Bob Taylor',
    abstract: 'Time-series database workloads exhibit highly skewed temporal access patterns. We propose an adaptive indexing strategy that maintains a hot tier of recent timestamps in memory while compressing older data with delta encoding. Benchmarks show 3.2x throughput at half the storage cost.',
    keywords: 'databases, time-series, indexing, query optimization',
    tags: 'Databases, Systems',
  },
  {
    username: 'alice',
    title: 'Attention Pruning for Edge Deployment of Language Models',
    authors: 'Alice Smith',
    abstract: 'Attention heads in transformer language models are highly redundant. We measure per-head contribution on the GLUE benchmark and prune up to 60 percent of heads without measurable quality loss, enabling deployment on edge devices with 1GB of RAM. Released as a one-line library.',
    keywords: 'NLP, transformers, pruning, edge ML',
    tags: 'NLP, ML, Edge',
  },
];

const coauthorships = [
  // Sample: alice + reviewer_se are both at U of Auckland and have co-authored before -> COI flag
  { a: 'alice', b: 'reviewer_se', year: 2024 },
];

async function ensureUser(u) {
  const existing = await get('SELECT id FROM users WHERE username = ?', [u.username]);
  if (existing) return existing.id;
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const result = await run(
    'INSERT INTO users (username, email, password_hash, role, expertise, affiliation) VALUES (?,?,?,?,?,?)',
    [u.username, u.email, hash, u.role, u.expertise, u.affiliation || '']
  );
  return result.lastID;
}

async function ensurePaper(p, authorId) {
  const existing = await get('SELECT id FROM papers WHERE title = ?', [p.title]);
  if (existing) return existing.id;
  const result = await run(
    `INSERT INTO papers (author_id, title, authors, abstract, keywords, tags, review_status)
     VALUES (?,?,?,?,?,?, 'pending')`,
    [authorId, p.title, p.authors, p.abstract, p.keywords, p.tags || null]
  );
  return result.lastID;
}

async function ensureCoauthorship(aId, bId, year) {
  const [low, high] = aId < bId ? [aId, bId] : [bId, aId];
  const existing = await get('SELECT id FROM coauthorships WHERE user_a_id = ? AND user_b_id = ?', [low, high]);
  if (existing) return;
  await run('INSERT INTO coauthorships (user_a_id, user_b_id, year) VALUES (?,?,?)', [low, high, year]);
}

async function seed() {
  const ids = {};
  for (const u of users) ids[u.username] = await ensureUser(u);
  for (const p of samplePapers) await ensurePaper(p, ids[p.username]);
  for (const c of coauthorships) await ensureCoauthorship(ids[c.a], ids[c.b], c.year);
  logger.info({ demoPassword: DEMO_PASSWORD }, 'Seed complete. All demo accounts share the same password.');
}

if (require.main === module) {
  seed().then(() => process.exit(0)).catch((err) => { logger.error({ err }, 'Seed failed'); process.exit(1); });
}

module.exports = seed;
