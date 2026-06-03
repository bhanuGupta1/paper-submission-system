'use strict';

const Paper = require('../models/Paper');
const Review = require('../models/Review');
const User = require('../models/User');
const Track = require('../models/Track');
const reviewerMatcher = require('../services/reviewerMatcher');
const plagiarism = require('../services/plagiarismDetector');
const writingAssistant = require('../services/writingAssistant');
const textExtract = require('../utils/textExtract');
const N = require('../services/notifications');
const slack = require('../services/slack');
const teams = require('../services/teams');
const webhooks = require('../services/webhooks');
const audit = require('../services/auditLog');
const logger = require('../utils/logger');
const { all, run } = require('../db/connection');
const path = require('path');
const fs = require('fs');

async function dashboard(req, res, next) {
  try {
    const stats = await Paper.authorStats(req.user.id);
    const papers = await Paper.listByAuthor(req.user.id);
    res.render('author/dashboard', { title: 'My submissions', papers, stats });
  } catch (err) { next(err); }
}

async function showSubmit(req, res, next) {
  try {
    const tracks = await Track.listActive();
    res.render('author/submit', { title: 'Submit a paper', error: req.query.error || null, form: {}, tracks });
  } catch (err) { next(err); }
}

async function submit(req, res, next) {
  try {
    const { title, authors, abstract, keywords, tags, trackId } = req.body;
    if (!title || !title.trim()) return res.redirect('/author/submit?error=' + encodeURIComponent('Title is required'));
    if (!authors || !authors.trim()) return res.redirect('/author/submit?error=' + encodeURIComponent('Author list is required'));
    if (!abstract || abstract.trim().length < 50) return res.redirect('/author/submit?error=' + encodeURIComponent('Abstract must be at least 50 characters'));

    if (trackId) {
      const track = await Track.findById(parseInt(trackId, 10));
      if (!track) return res.redirect('/author/submit?error=' + encodeURIComponent('Invalid track selected'));
      if (track.submission_deadline && new Date(track.submission_deadline) < new Date()) {
        return res.redirect('/author/submit?error=' + encodeURIComponent('Submission deadline for this track has passed'));
      }
    }

    const filePath = req.file ? req.file.path : null;
    const fileText = filePath ? await textExtract.extract(filePath).catch(() => null) : null;

    const paper = await Paper.create({ authorId: req.user.id, title: title.trim(), authors: authors.trim(), abstract: abstract.trim(), keywords, tags, filePath, fileText, trackId: trackId || null });

    // Run AI pipeline asynchronously — never block submission
    runAiPipeline(paper, req.user.id).catch((err) => logger.warn({ err: err.message, paperId: paper.id }, 'AI pipeline failed'));
    slack.notifyNewSubmission({ paperId: paper.id, title: paper.title, author: req.user.username, submittedAt: new Date() }).catch(() => {});
    teams.notifyNewSubmission({ paperId: paper.id, title: paper.title, author: req.user.username, submittedAt: new Date() }).catch(() => {});
    // Confirmation email to author
    const emailSvc = require('../services/email');
    User.findById(req.user.id).then((u) => {
      if (u && u.email) {
        const { subject, html, text } = emailSvc.submissionConfirmedEmail(u.username, paper.title, paper.id);
        emailSvc.send({ to: u.email, subject, html, text }).catch(() => {});
      }
    }).catch(() => {});
    webhooks.fire('submission', { paperId: paper.id, title: paper.title, author: req.user.username, status: 'pending' }).catch(() => {});
    audit.log(req.user.id, 'paper.submit', 'paper', paper.id, { title: paper.title }, req).catch(() => {});

    res.redirect(`/author/papers/${paper.id}`);
  } catch (err) { next(err); }
}

// Auto-fill: extract title/authors/abstract/keywords/tags from an uploaded manuscript.
// The file is parsed and discarded here — the real submit re-uploads it.
async function extractMetadata(req, res, next) {
  let filePath = null;
  try {
    if (!req.file) return res.status(400).json({ ok: false, message: 'No file received.' });
    filePath = req.file.path;

    const fileText = await textExtract.extract(filePath).catch(() => null);
    fs.promises.unlink(filePath).catch(() => {});
    filePath = null;

    if (!fileText || fileText.trim().length < 20) {
      return res.json({ ok: false, metadata: null, message: 'Could not read text from this file (a scanned-image PDF can\'t be parsed). Please fill the fields manually.' });
    }

    const llm = require('../services/llm');
    const result = await writingAssistant.extractMetadata(fileText, req.user.id);
    const provider = llm.providerName || (result && result.provider) || 'heuristic';

    if (!result) {
      return res.json({ ok: false, metadata: null, provider, message: 'Auto-fill is unavailable right now. Please fill the fields manually.' });
    }

    const toStr = (v) => Array.isArray(v) ? v.filter(Boolean).join(', ') : (v == null ? '' : String(v));
    const metadata = {
      title: toStr(result.title).trim().slice(0, 500),
      authors: toStr(result.authors).trim().slice(0, 1000),
      abstract: toStr(result.abstract).trim().slice(0, 8000),
      keywords: toStr(result.keywords).trim().slice(0, 500),
      tags: toStr(result.tags).trim().slice(0, 500),
    };
    res.json({ ok: true, metadata, confidence: result.confidence ?? null, provider });
  } catch (err) {
    if (filePath) fs.promises.unlink(filePath).catch(() => {});
    next(err);
  }
}

async function runAiPipeline(paper, userId) {
  const [analysis, aiKeywords] = await Promise.allSettled([
    plagiarism.analyse(paper),
    writingAssistant.keywords(paper.abstract, userId, 6),
  ]);

  const meta = {};
  if (analysis.status === 'fulfilled') {
    meta.similarityScore = analysis.value.similarity_score;
    meta.aiTextLikelihood = analysis.value.ai_text_likelihood;
  }
  if (aiKeywords.status === 'fulfilled') {
    meta.aiKeywords = Array.isArray(aiKeywords.value) ? aiKeywords.value.join(', ') : aiKeywords.value;
  }
  if (Object.keys(meta).length) await Paper.updateAiMetadata(paper.id, meta);

  const picked = await reviewerMatcher.autoAssign(paper, { count: 2, excludeUserId: userId });
  if (picked.length > 0) {
    await Paper.updateStatus(paper.id, 'under_review');
    for (const r of picked) {
      await N.notify(r.id, {
        kind: 'assignment',
        title: `New review assignment: ${paper.title}`,
        body: `Auto-assigned based on expertise match (score ${(r.score * 100).toFixed(0)}%).`,
        link: `/reviewer/papers/${paper.id}`,
      });
    }
    slack.notifyReviewAssigned({ paperId: paper.id, paperTitle: paper.title, reviewerUsername: picked.map((r) => r.username).join(', ') }).catch(() => {});
    teams.notifyReviewAssigned({ paperId: paper.id, paperTitle: paper.title, reviewerUsername: picked.map((r) => r.username).join(', ') }).catch(() => {});
    // Email auto-assigned reviewers respecting their prefs
    const emailSvcPipe = require('../services/email');
    for (const r of picked) {
      const reviewer = await User.findById(r.id).catch(() => null);
      if (!reviewer || !reviewer.email) continue;
      const prefs = reviewer.notification_prefs ? (() => { try { return JSON.parse(reviewer.notification_prefs); } catch { return {}; } })() : {};
      if (prefs.email_on_assignment !== false) {
        const { subject, html, text } = emailSvcPipe.reviewAssignmentEmail(reviewer.username, paper.title, paper.id, null);
        emailSvcPipe.send({ to: reviewer.email, subject, html, text }).catch(() => {});
      }
    }
  }

  await N.notify(userId, {
    kind: 'submission',
    title: `Submission received: ${paper.title}`,
    body: `${picked.length > 0 ? `Assigned ${picked.length} reviewer(s). ` : ''}${meta.similarityScore != null ? `Similarity ${(meta.similarityScore * 100).toFixed(0)}%, AI-text ${(meta.aiTextLikelihood * 100).toFixed(0)}%.` : ''}`,
    link: `/author/papers/${paper.id}`,
  });
}

async function paperDetail(req, res, next) {
  try {
    const paper = await Paper.findById(req.params.id);
    if (!paper || paper.author_id !== req.user.id) {
      return res.status(404).render('error', { title: 'Not Found', message: 'Paper not found.' });
    }
    // Show reviews blinded — no reviewer names visible to authors
    const allReviews = await Review.listByPaper(paper.id);
    const blindedReviews = allReviews.filter((r) => r.review_date).map(({ reviewer_id, reviewer_username, ...rest }) => ({
      ...rest,
      reviewer_username: '[Anonymous Reviewer]',
    }));
    const decisions = await Paper.decisionsForPaper(paper.id);
    const versions = await Paper.versionsForPaper(paper.id);
    const canRevise = paper.review_status === 'revisions';
    res.render('author/paper', { title: paper.title, paper, reviews: blindedReviews, decisions, versions, canRevise });
  } catch (err) { next(err); }
}

async function showRevise(req, res, next) {
  try {
    const paper = await Paper.findById(req.params.id);
    if (!paper || paper.author_id !== req.user.id) {
      return res.status(404).render('error', { title: 'Not Found', message: 'Paper not found.' });
    }
    if (paper.review_status !== 'revisions') {
      return res.redirect(`/author/papers/${paper.id}?error=` + encodeURIComponent('This paper is not awaiting revision'));
    }
    const allReviews = await Review.listByPaper(paper.id);
    const reviewsWithFeedback = allReviews.filter((r) => r.recommendation && !r.declined_at).map(({ reviewer_id, reviewer_username, ...rest }) => ({
      ...rest,
      reviewer_username: '[Anonymous Reviewer]',
    }));
    res.render('author/revise', { title: `Revise: ${paper.title}`, paper, reviews: reviewsWithFeedback, error: req.query.error || null });
  } catch (err) { next(err); }
}

async function submitRevision(req, res, next) {
  try {
    const paper = await Paper.findById(req.params.id);
    if (!paper || paper.author_id !== req.user.id) {
      return res.status(404).render('error', { title: 'Not Found', message: 'Paper not found.' });
    }
    if (paper.review_status !== 'revisions') {
      return res.redirect(`/author/papers/${paper.id}?error=` + encodeURIComponent('This paper is not awaiting revision'));
    }
    const { title, authors, abstract, keywords, changeNote } = req.body;
    if (!title || !abstract || !changeNote || changeNote.trim().length < 10) {
      return res.redirect(`/author/papers/${paper.id}/revise?error=` + encodeURIComponent('Title, abstract and a response note (10+ chars) are required'));
    }
    const filePath = req.file ? req.file.path : null;
    const fileText = filePath ? await textExtract.extract(filePath).catch(() => null) : null;

    await Paper.submitRevision({ paperId: paper.id, title: title.trim(), abstract: abstract.trim(), authors: authors || paper.authors, keywords: keywords || paper.keywords, filePath, fileText, changeNote: changeNote.trim() });

    // Re-run AI analysis on revised version
    const updated = await Paper.findById(paper.id);
    runAiPipeline(updated, req.user.id).catch(() => {});

    await N.notify(req.user.id, { kind: 'submission', title: `Revision submitted: ${title}`, body: `Version ${updated.current_version} submitted for review.`, link: `/author/papers/${paper.id}` });

    res.redirect(`/author/papers/${paper.id}`);
  } catch (err) { next(err); }
}

async function downloadPaper(req, res, next) {
  try {
    const paper = await Paper.findById(req.params.id);
    if (!paper || paper.author_id !== req.user.id || !paper.file_path) {
      return res.status(404).render('error', { title: 'Not Found', message: 'File not found.' });
    }
    res.download(paper.file_path, path.basename(paper.file_path));
  } catch (err) { next(err); }
}

async function viewPaper(req, res, next) {
  try {
    const paper = await Paper.findById(req.params.id);
    if (!paper || paper.author_id !== req.user.id || !paper.file_path) {
      return res.status(404).render('error', { title: 'Not Found', message: 'File not found.' });
    }
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', 'inline');
    res.sendFile(path.resolve(paper.file_path));
  } catch (err) { next(err); }
}

async function profile(req, res, next) {
  try {
    const user = await User.findById(req.user.id);
    const stats = await Paper.authorStats(req.user.id);
    const aiUsage = await all('SELECT action, COUNT(*) AS n FROM ai_audit WHERE user_id = ? GROUP BY action ORDER BY n DESC', [req.user.id]);
    let notificationPrefs = {};
    try { notificationPrefs = user.notification_prefs ? JSON.parse(user.notification_prefs) : {}; } catch {}
    res.render('author/profile', { title: 'Profile', user, stats, aiUsage, notificationPrefs, error: req.query.error || null, success: req.query.success || null });
  } catch (err) { next(err); }
}

async function updateProfile(req, res, next) {
  try {
    const { email, expertise, affiliation } = req.body;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.redirect('/author/profile?error=' + encodeURIComponent('Please enter a valid email address'));
    }
    await User.updateProfile(req.user.id, { email: email || null, expertise, affiliation });
    res.redirect('/author/profile?success=Profile updated');
  } catch (err) { next(err); }
}

// ── Notification preferences ──────────────────────────────────────────────────

async function updateNotificationPrefs(req, res, next) {
  try {
    const { slack_webhook, teams_webhook, email_on_assignment, email_on_decision, digest } = req.body;

    // Basic URL validation for webhook fields
    const validUrl = (u) => !u || u.startsWith('https://');
    if (!validUrl(slack_webhook) || !validUrl(teams_webhook)) {
      return res.redirect('/author/profile?error=' + encodeURIComponent('Webhook URLs must start with https://'));
    }

    const prefs = {
      slack_webhook: slack_webhook ? slack_webhook.trim() : '',
      teams_webhook: teams_webhook ? teams_webhook.trim() : '',
      email_on_assignment: email_on_assignment === 'on',
      email_on_decision: email_on_decision === 'on',
      digest: ['immediate', 'daily'].includes(digest) ? digest : 'immediate',
    };
    await User.saveNotificationPrefs(req.user.id, prefs);
    await audit.log(req.user.id, 'profile.notification_prefs_updated', 'user', req.user.id, null, req);
    res.redirect('/author/profile?success=Notification preferences saved#notification-prefs');
  } catch (err) { next(err); }
}

// ── GDPR/FERPA ────────────────────────────────────────────────────────────────

async function exportMyData(req, res, next) {
  try {
    const user = await User.findById(req.user.id);
    const papers = await Paper.listByAuthor(req.user.id);
    const reviews = await all('SELECT * FROM reviews WHERE reviewer_id = ?', [req.user.id]);
    const notifications = await all('SELECT kind, title, body, link, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC', [req.user.id]);
    const decisions = await all('SELECT d.*, p.title AS paper_title FROM decisions d JOIN papers p ON p.id = d.paper_id WHERE p.author_id = ?', [req.user.id]);

    const payload = {
      exportedAt: new Date().toISOString(),
      profile: {
        id: user.id, username: user.username, email: user.email,
        role: user.role, expertise: user.expertise, affiliation: user.affiliation,
        orcid_id: user.orcid_id, created_at: user.created_at, last_login: user.last_login,
      },
      papers, reviews, decisions, notifications,
    };

    await audit.log(req.user.id, 'gdpr.export', 'user', req.user.id, null, req);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="papersub-data-${user.username}-${new Date().toISOString().slice(0,10)}.json"`);
    res.send(JSON.stringify(payload, null, 2));
  } catch (err) { next(err); }
}

async function requestDeletion(req, res, next) {
  try {
    const { confirmation } = req.body;
    if (confirmation !== 'DELETE MY ACCOUNT') {
      return res.redirect('/author/profile?error=' + encodeURIComponent('Please type DELETE MY ACCOUNT exactly to confirm'));
    }
    await run('UPDATE users SET is_active = 0, account_deletion_requested_at = datetime(\'now\') WHERE id = ?', [req.user.id]);
    await audit.log(req.user.id, 'gdpr.deletion_requested', 'user', req.user.id, null, req);
    req.session.destroy(() => {
      res.render('auth/deletion-requested', { title: 'Account deletion requested' });
    });
  } catch (err) { next(err); }
}

// ── API key management ────────────────────────────────────────────────────────
const apiKeys = require('../services/apiKeys');

async function listApiKeys(req, res, next) {
  try {
    const keys = await apiKeys.listForUser(req.user.id);
    res.json({ keys });
  } catch (err) { next(err); }
}

async function createApiKey(req, res, next) {
  try {
    const { name, scopes, expiresInDays } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
    const validScopes = ['read:papers', 'write:papers', 'read:reviews', 'admin'];
    const chosenScopes = (Array.isArray(scopes) ? scopes : [scopes]).filter((s) => validScopes.includes(s)).join(',');
    const result = await apiKeys.create({ userId: req.user.id, name: name.trim(), scopes: chosenScopes || 'read:papers', expiresInDays: parseInt(expiresInDays, 10) || null });
    await audit.log(req.user.id, 'api_key.created', 'api_keys', null, { name, prefix: result.prefix }, req);
    res.json({ key: result.key, prefix: result.prefix, message: 'Save this key — it will not be shown again.' });
  } catch (err) { next(err); }
}

async function revokeApiKey(req, res, next) {
  try {
    await apiKeys.revoke(req.params.id, req.user.id);
    await audit.log(req.user.id, 'api_key.revoked', 'api_keys', req.params.id, {}, req);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function deleteApiKey(req, res, next) {
  try {
    await apiKeys.deleteKey(req.params.id, req.user.id);
    await audit.log(req.user.id, 'api_key.deleted', 'api_keys', req.params.id, {}, req);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = { dashboard, showSubmit, submit, extractMetadata, paperDetail, showRevise, submitRevision, downloadPaper, viewPaper, profile, updateProfile, updateNotificationPrefs, exportMyData, requestDeletion, listApiKeys, createApiKey, revokeApiKey, deleteApiKey };
