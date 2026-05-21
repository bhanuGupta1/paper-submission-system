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
const logger = require('../utils/logger');
const { all } = require('../db/connection');
const path = require('path');

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

    res.redirect(`/author/papers/${paper.id}`);
  } catch (err) { next(err); }
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
    res.render('author/revise', { title: `Revise: ${paper.title}`, paper, error: req.query.error || null });
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

async function profile(req, res, next) {
  try {
    const user = await User.findById(req.user.id);
    const stats = await Paper.authorStats(req.user.id);
    const aiUsage = await all('SELECT action, COUNT(*) AS n FROM ai_audit WHERE user_id = ? GROUP BY action ORDER BY n DESC', [req.user.id]);
    res.render('author/profile', { title: 'Profile', user, stats, aiUsage, error: req.query.error || null, success: req.query.success || null });
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

module.exports = { dashboard, showSubmit, submit, paperDetail, showRevise, submitRevision, downloadPaper, profile, updateProfile };
