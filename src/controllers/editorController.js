'use strict';

const path = require('path');
const Paper = require('../models/Paper');
const Review = require('../models/Review');
const User = require('../models/User');
const reviewerMatcher = require('../services/reviewerMatcher');
const coi = require('../services/conflictOfInterest');
const N = require('../services/notifications');
const { all } = require('../db/connection');

async function dashboard(req, res, next) {
  try {
    const status = req.query.status || null;
    const q = (req.query.q || '').trim() || null;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = 20;
    const offset = (page - 1) * pageSize;
    const total = await Paper.countAll({ status, q });
    const papers = await Paper.listAll({ limit: pageSize, offset, status, q });
    const reviewers = await User.listReviewers();

    const enriched = await Promise.all(papers.map(async (p) => {
      const ranked = await reviewerMatcher.rankReviewers(p, { excludeUserId: p.author_id, topK: 3 });
      const annotatedAll = await coi.annotate(p, reviewers);
      const assigned = await Review.listByPaper(p.id);
      return { ...p, suggestions: ranked, annotatedReviewers: annotatedAll, assigned };
    }));

    res.render('editor/dashboard', {
      title: 'Editor dashboard',
      papers: enriched, reviewers,
      filter: { status, q, page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) },
    });
  } catch (err) { next(err); }
}

async function assignReviewer(req, res, next) {
  try {
    const { paperId, reviewerId } = req.body;
    if (!paperId || !reviewerId) return res.status(400).render('error', { title: 'Bad request', message: 'paperId and reviewerId required.' });

    const paper = await Paper.findById(paperId);
    const reviewer = await User.findById(reviewerId);
    if (!paper || !reviewer) return res.status(404).render('error', { title: 'Not Found', message: 'Paper or reviewer not found.' });

    // Show conflict warning if editor explicitly overrides COI (we don't block, just note).
    const cohk = await coi.check(paper, reviewer);

    const existing = await Review.findByPaperReviewer(paperId, reviewerId);
    if (!existing) await Review.assign(paperId, reviewerId);
    await Paper.updateStatus(paperId, 'under_review');

    // Notify reviewer.
    await N.notify(reviewer.id, {
      kind: 'assignment',
      title: `New review assignment: ${paper.title}`,
      body: cohk.hasConflict ? `Editor flagged a potential conflict (${cohk.signals.map((s) => s.label).join('; ')}). Please review and decline if appropriate.` : 'A new manuscript has been assigned to you.',
      link: `/reviewer/papers/${paperId}`,
    });
    // Notify author the paper is under review.
    await N.notify(paper.author_id, {
      kind: 'status',
      title: `Your paper is under review`,
      body: `"${paper.title}" was assigned to ${reviewer.username}.`,
      link: `/author/papers/${paperId}`,
    });

    res.redirect('/editor');
  } catch (err) { next(err); }
}

async function decide(req, res, next) {
  try {
    const { paperId, decision, note } = req.body;
    const allowed = ['accepted', 'rejected', 'revisions'];
    if (!allowed.includes(decision)) return res.status(400).render('error', { title: 'Bad request', message: 'Invalid decision.' });

    const paper = await Paper.findById(paperId);
    if (!paper) return res.status(404).render('error', { title: 'Not Found', message: 'Paper not found.' });

    await Paper.updateStatus(paperId, decision);
    await Paper.recordDecision({ paperId, editorId: req.user.id, fromStatus: paper.review_status, toStatus: decision, note });

    await N.notify(paper.author_id, {
      kind: 'decision',
      title: `Decision on "${paper.title}": ${decision.toUpperCase()}`,
      body: note || 'See your dashboard for details.',
      link: `/author/papers/${paperId}`,
    });
    res.redirect('/editor');
  } catch (err) { next(err); }
}

async function updateTags(req, res, next) {
  try {
    await Paper.updateTags(req.params.id, (req.body.tags || '').trim());
    res.redirect('/editor');
  } catch (err) { next(err); }
}

async function downloadManuscript(req, res, next) {
  try {
    const paper = await Paper.findById(req.params.id);
    if (!paper || !paper.file_path) return res.status(404).render('error', { title: 'Not Found', message: 'Manuscript not found.' });
    res.download(paper.file_path, path.basename(paper.file_path));
  } catch (err) { next(err); }
}

async function auditTrail(req, res, next) {
  try {
    const paper = await Paper.findById(req.params.id);
    if (!paper) return res.status(404).render('error', { title: 'Not Found', message: 'Paper not found.' });

    const reviews = await Review.listByPaper(paper.id);
    const decisions = await Paper.decisionsForPaper(paper.id);
    const aiCalls = await all(
      `SELECT ai_audit.*, users.username FROM ai_audit
       LEFT JOIN users ON users.id = ai_audit.user_id
       WHERE ai_audit.paper_id = ? OR (ai_audit.paper_id IS NULL AND ai_audit.user_id = ?)
       ORDER BY ai_audit.created_at DESC LIMIT 100`,
      [paper.id, paper.author_id]
    );
    res.render('editor/audit', { title: `Audit · ${paper.title}`, paper, reviews, decisions, aiCalls });
  } catch (err) { next(err); }
}

module.exports = { dashboard, assignReviewer, decide, updateTags, downloadManuscript, auditTrail };
