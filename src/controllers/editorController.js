'use strict';

const path = require('path');
const Paper = require('../models/Paper');
const Review = require('../models/Review');
const User = require('../models/User');
const Discussion = require('../models/Discussion');
const DecisionLetter = require('../models/DecisionLetter');
const reviewerMatcher = require('../services/reviewerMatcher');
const coi = require('../services/conflictOfInterest');
const analytics = require('../services/operationsAnalytics');
const N = require('../services/notifications');
const emailService = require('../services/email');
const slack = require('../services/slack');
const teams = require('../services/teams');
const webhooks = require('../services/webhooks');
const invitation = require('../services/invitation');
const config = require('../config');
const { all } = require('../db/connection');
const logger = require('../utils/logger');

// Strip author identity for double-blind — editors see it, reviewers don't
function blindPaper(paper, { showAuthor = true } = {}) {
  if (showAuthor) return paper;
  const { author_id, author_username, authors, ...rest } = paper;
  return { ...rest, author_username: '[Anonymous]', authors: '[Blinded for review]' };
}

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
    const ops = { statusBreakdown: await analytics.getStatusBreakdown(), reviewFunnel: await analytics.getReviewFunnel() };

    const enriched = await Promise.all(papers.map(async (p) => {
      const ranked = await reviewerMatcher.rankReviewers(p, { excludeUserId: p.author_id, topK: 3 });
      const annotatedAll = await coi.annotate(p, reviewers);
      const assigned = await Review.listByPaper(p.id);
      const coiDeclarations = await Review.coiForPaper(p.id);
      return { ...p, suggestions: ranked, annotatedReviewers: annotatedAll, assigned, coiDeclarations };
    }));

    res.render('editor/dashboard', {
      title: 'Editor dashboard',
      papers: enriched, reviewers, ops,
      filter: { status, q, page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) },
    });
  } catch (err) { next(err); }
}

async function assignReviewer(req, res, next) {
  try {
    const { paperId, reviewerId, deadline } = req.body;
    if (!paperId || !reviewerId) return res.status(400).render('error', { title: 'Bad request', message: 'paperId and reviewerId required.' });

    const [paper, reviewer] = await Promise.all([Paper.findById(paperId), User.findById(reviewerId)]);
    if (!paper || !reviewer) return res.status(404).render('error', { title: 'Not Found', message: 'Paper or reviewer not found.' });

    const cohk = await coi.check(paper, reviewer);
    const existing = await Review.findByPaperReviewer(paperId, reviewerId);
    if (!existing) await Review.assign(paperId, reviewerId, deadline || null);
    if (deadline && existing) await Review.setDeadline(existing.id, deadline);
    await Paper.updateStatus(paperId, 'under_review');

    await N.notify(reviewer.id, {
      kind: 'assignment',
      title: `New review assignment: ${paper.title}`,
      body: cohk.hasConflict
        ? `Editor flagged a potential conflict (${cohk.signals.map((s) => s.label).join('; ')}). Please review and decline if appropriate.`
        : `A new manuscript has been assigned to you${deadline ? `. Review due: ${deadline}` : ''}.`,
      link: `/reviewer/papers/${paperId}`,
    });
    await N.notify(paper.author_id, { kind: 'status', title: 'Your paper is under review', body: `"${paper.title}" was assigned to a reviewer.`, link: `/author/papers/${paperId}` });

    // Email reviewer if they have an email address and haven't opted out
    if (reviewer.email) {
      const prefs = reviewer.notification_prefs ? (() => { try { return JSON.parse(reviewer.notification_prefs); } catch { return {}; } })() : {};
      if (prefs.email_on_assignment !== false) {
        const { subject, html, text } = emailService.reviewAssignmentEmail(reviewer.username, paper.title, paperId, deadline || null);
        emailService.send({ to: reviewer.email, subject, html, text }).catch((e) => logger.warn({ e }, 'Assignment email failed'));
      }
    }

    res.redirect('/editor');
  } catch (err) { next(err); }
}

async function bulkAssign(req, res, next) {
  try {
    let paperIds = req.body.paperIds;
    const { reviewerId, deadline } = req.body;
    if (!paperIds || !reviewerId) return res.status(400).json({ error: 'paperIds and reviewerId required' });
    if (!Array.isArray(paperIds)) paperIds = [paperIds];

    const reviewer = await User.findById(reviewerId);
    if (!reviewer) return res.status(404).json({ error: 'Reviewer not found' });

    const results = [];
    for (const paperId of paperIds) {
      const paper = await Paper.findById(paperId);
      if (!paper) { results.push({ paperId, status: 'not_found' }); continue; }
      const existing = await Review.findByPaperReviewer(paperId, reviewerId);
      if (!existing) {
        await Review.assign(paperId, reviewerId, deadline || null);
        await Paper.updateStatus(paperId, 'under_review');
        await N.notify(reviewer.id, { kind: 'assignment', title: `New review assignment: ${paper.title}`, body: 'A new manuscript has been assigned to you.', link: `/reviewer/papers/${paperId}` });
        if (reviewer.email) {
          const prefs = reviewer.notification_prefs ? (() => { try { return JSON.parse(reviewer.notification_prefs); } catch { return {}; } })() : {};
          if (prefs.email_on_assignment !== false) {
            const { subject, html, text } = emailService.reviewAssignmentEmail(reviewer.username, paper.title, paperId, null);
            emailService.send({ to: reviewer.email, subject, html, text }).catch(() => {});
          }
        }
        results.push({ paperId, status: 'assigned' });
      } else {
        results.push({ paperId, status: 'already_assigned' });
      }
    }
    res.json({ ok: true, results });
  } catch (err) { next(err); }
}

async function decide(req, res, next) {
  try {
    const { paperId, decision, note, generateLetter } = req.body;
    const allowed = ['accepted', 'rejected', 'revisions'];
    if (!allowed.includes(decision)) return res.status(400).render('error', { title: 'Bad request', message: 'Invalid decision.' });

    const paper = await Paper.findById(paperId);
    if (!paper) return res.status(404).render('error', { title: 'Not Found', message: 'Paper not found.' });

    await Paper.updateStatus(paperId, decision);
    const decisionRow = await Paper.recordDecision({ paperId, editorId: req.user.id, fromStatus: paper.review_status, toStatus: decision, note });

    // Generate decision letter if requested
    if (generateLetter) {
      const reviews = await Review.listByPaper(paperId);
      const letterBody = buildDecisionLetter({ paper, decision, note, reviews, editorUsername: req.user.username });
      await DecisionLetter.create({ paperId, decisionId: decisionRow.lastID, editorId: req.user.id, subject: `Decision on "${paper.title}"`, body: letterBody });
    }

    const author = await User.findById(paper.author_id);
    await N.notify(paper.author_id, { kind: 'decision', title: `Decision on "${paper.title}": ${decision.toUpperCase()}`, body: note || 'See your dashboard for details.', link: `/author/papers/${paperId}` });

    if (author && author.email && emailService) {
      const { subject, html, text } = emailService.submissionStatusEmail(author.username, paper.title, decision, `/author/papers/${paperId}`);
      emailService.send({ to: author.email, subject, html, text }).catch((e) => logger.warn({ e }, 'Decision email failed'));
    }

    // Slack + Teams + webhook notifications (non-blocking)
    slack.notifyDecision({ paperId, title: paper.title, decision, editorUsername: req.user.username }).catch(() => {});
    teams.notifyDecision({ paperId, title: paper.title, decision, editorUsername: req.user.username }).catch(() => {});
    webhooks.fire('decision', { paperId, title: paper.title, decision, editorUsername: req.user.username }).catch(() => {});

    res.redirect('/editor');
  } catch (err) { next(err); }
}

function buildDecisionLetter({ paper, decision, note, reviews, editorUsername }) {
  const scores = reviews.filter((r) => r.review_date).map((r) => ({
    novelty: r.novelty_score, clarity: r.clarity_score, significance: r.significance_score,
  }));
  const avg = (arr) => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : 'N/A';
  const decisionText = { accepted: 'ACCEPTED', rejected: 'REJECTED', revisions: 'REVISIONS REQUIRED' }[decision] || decision;

  return `Dear Author,

We have completed the review of your manuscript "${paper.title}".

Decision: ${decisionText}

${note ? `Editor's note:\n${note}\n` : ''}
${reviews.length > 0 ? `Review summary (${reviews.length} reviewer${reviews.length > 1 ? 's' : ''}):
- Average novelty score: ${avg(scores.map((s) => s.novelty).filter(Boolean))}
- Average clarity score: ${avg(scores.map((s) => s.clarity).filter(Boolean))}
- Average significance score: ${avg(scores.map((s) => s.significance).filter(Boolean))}
` : ''}
${decision === 'revisions' ? 'Please address the reviewers\' comments in a revised submission. Log in to your author dashboard to upload your revision.\n' : ''}
${decision === 'accepted' ? 'Congratulations! Your paper has been accepted for publication.\n' : ''}

Sincerely,
${editorUsername}
Editorial Team`;
}

async function viewDecisionLetter(req, res, next) {
  try {
    const paper = await Paper.findById(req.params.id);
    if (!paper) return res.status(404).render('error', { title: 'Not Found', message: 'Paper not found.' });
    const letters = await DecisionLetter.findByPaper(paper.id);
    res.render('editor/decision-letter', { title: `Decision letters | ${paper.title}`, paper, letters });
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

async function viewManuscript(req, res, next) {
  try {
    const paper = await Paper.findById(req.params.id);
    if (!paper || !paper.file_path) return res.status(404).render('error', { title: 'Not Found', message: 'Manuscript not found.' });
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', 'inline');
    res.sendFile(path.resolve(paper.file_path));
  } catch (err) { next(err); }
}

async function reviewProgress(req, res, next) {
  try {
    const papers = await Paper.listAll({ limit: 200, offset: 0, status: null, q: null });
    const enriched = await Promise.all(papers.map(async (p) => {
      const reviews = await Review.listByPaper(p.id);
      const total = reviews.filter((r) => !r.declined_at).length;
      const submitted = reviews.filter((r) => r.recommendation && !r.declined_at).length;
      const declined = reviews.filter((r) => r.declined_at).length;
      const overdue = reviews.filter((r) => !r.recommendation && !r.declined_at && r.deadline && new Date(r.deadline) < new Date()).length;
      const pending = total - submitted;
      return { ...p, reviewStats: { total, submitted, pending, declined, overdue } };
    }));
    const active = enriched.filter((p) => ['pending', 'under_review'].includes(p.review_status));
    const decided = enriched.filter((p) => ['accepted', 'rejected', 'revisions'].includes(p.review_status));
    res.render('editor/review-progress', { title: 'Review progress', active, decided });
  } catch (err) { next(err); }
}

async function auditTrail(req, res, next) {
  try {
    const paper = await Paper.findById(req.params.id);
    if (!paper) return res.status(404).render('error', { title: 'Not Found', message: 'Paper not found.' });
    const [reviews, decisions, aiCalls, versions, coiDeclarations] = await Promise.all([
      Review.listByPaper(paper.id),
      Paper.decisionsForPaper(paper.id),
      all('SELECT ai_audit.*, users.username FROM ai_audit LEFT JOIN users ON users.id = ai_audit.user_id WHERE ai_audit.paper_id = ? OR (ai_audit.paper_id IS NULL AND ai_audit.user_id = ?) ORDER BY ai_audit.created_at DESC LIMIT 100', [paper.id, paper.author_id]),
      Paper.versionsForPaper(paper.id),
      Review.coiForPaper(paper.id),
    ]);
    res.render('editor/audit', { title: `Audit | ${paper.title}`, paper, reviews, decisions, aiCalls, versions, coiDeclarations });
  } catch (err) { next(err); }
}

// ── Discussion threads ────────────────────────────────────────────────────────

async function getDiscussion(req, res, next) {
  try {
    const paper = await Paper.findById(req.params.id);
    if (!paper) return res.status(404).json({ error: 'Not found' });
    const messages = await Discussion.listByPaper(paper.id);
    res.json({ messages });
  } catch (err) { next(err); }
}

async function postDiscussion(req, res, next) {
  try {
    const paper = await Paper.findById(req.params.id);
    if (!paper) return res.status(404).json({ error: 'Not found' });
    const message = (req.body.message || '').trim();
    if (!message) return res.status(400).json({ error: 'Message cannot be empty' });
    if (message.length > 2000) return res.status(400).json({ error: 'Message too long (max 2000 characters)' });
    await Discussion.post({ paperId: paper.id, authorId: req.user.id, message, parentId: req.body.parentId || null });
    // Notify other editors/reviewers assigned to this paper
    const assigned = await Review.listByPaper(paper.id);
    for (const r of assigned) {
      if (r.reviewer_id !== req.user.id) {
        await N.notify(r.reviewer_id, { kind: 'assignment', title: `New discussion on "${paper.title}"`, body: message.slice(0, 100), link: `/reviewer/papers/${paper.id}` });
      }
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function inviteReviewer(req, res, next) {
  try {
    const { paperId, email } = req.body;
    if (!paperId || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid paperId and email are required' });
    }
    const paper = await Paper.findById(paperId);
    if (!paper) return res.status(404).json({ error: 'Paper not found' });

    const token = await invitation.create({ paperId, invitedBy: req.user.id, email });
    const inviteUrl = `${config.appUrl}/auth/invite/${token}`;
    const { subject, html, text } = emailService.reviewerInvitationEmail(req.user.username, paper.title, inviteUrl);
    await emailService.send({ to: email, subject, html, text });

    res.json({ ok: true, message: `Invitation sent to ${email}` });
  } catch (err) { next(err); }
}

async function listInvitations(req, res, next) {
  try {
    const { paperId } = req.params;
    const invitations = await invitation.listForPaper(paperId);
    res.json({ invitations });
  } catch (err) { next(err); }
}

async function analyticsView(req, res, next) {
  try {
    const data = await analytics.getEditorAnalytics();
    res.render('editor/analytics', { title: 'Editorial analytics', ...data });
  } catch (err) { next(err); }
}

module.exports = {
  dashboard, assignReviewer, bulkAssign, decide, viewDecisionLetter,
  updateTags, downloadManuscript, viewManuscript, reviewProgress, auditTrail,
  getDiscussion, postDiscussion, inviteReviewer, listInvitations, analyticsView,
};
