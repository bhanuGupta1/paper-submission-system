'use strict';

const Paper = require('../models/Paper');
const Review = require('../models/Review');
const User = require('../models/User');
const reviewerMatcher = require('../services/reviewerMatcher');
const plagiarism = require('../services/plagiarismDetector');
const writingAssistant = require('../services/writingAssistant');
const textExtract = require('../utils/textExtract');
const N = require('../services/notifications');
const logger = require('../utils/logger');
const { all, get } = require('../db/connection');

async function dashboard(req, res, next) {
  try {
    const stats = await Paper.authorStats(req.user.id);
    const papers = await Paper.listByAuthor(req.user.id);
    res.render('author/dashboard', { title: 'My submissions', papers, stats });
  } catch (err) { next(err); }
}

function showSubmit(req, res) {
  res.render('author/submit', { title: 'Submit a paper', error: req.query.error || null, form: {} });
}

async function submit(req, res, next) {
  try {
    const { title, authors, abstract, keywords, tags } = req.body;
    if (!title || !authors || !abstract) return res.redirect('/author/submit?error=Title, authors and abstract are required');
    const filePath = req.file ? req.file.path : null;
    const fileText = filePath ? await textExtract.extract(filePath) : null;

    const result = await Paper.create({ authorId: req.user.id, title, authors, abstract, keywords, tags, filePath, fileText });
    const paper = await Paper.findById(result.lastID);

    try {
      const analysis = await plagiarism.analyse(paper);
      const aiKeywords = await writingAssistant.keywords(abstract, req.user.id, 6);
      await Paper.updateAiMetadata(paper.id, {
        aiKeywords: aiKeywords.join(', '),
        similarityScore: analysis.similarity_score,
        aiTextLikelihood: analysis.ai_text_likelihood,
      });
      const picked = await reviewerMatcher.autoAssign(paper, { count: 2, excludeUserId: req.user.id });
      await Paper.updateStatus(paper.id, 'under_review');

      // Notify all assigned reviewers
      for (const r of picked) {
        await N.notify(r.id, {
          kind: 'assignment',
          title: `New review assignment: ${paper.title}`,
          body: `Auto-assigned based on expertise match (score ${(r.score * 100).toFixed(0)}%).`,
          link: `/reviewer/papers/${paper.id}`,
        });
      }
      // Notify author
      await N.notify(req.user.id, {
        kind: 'submission',
        title: `Submission received: ${paper.title}`,
        body: `Assigned ${picked.length} reviewer(s). Similarity ${(analysis.similarity_score * 100).toFixed(0)}%, AI-text ${(analysis.ai_text_likelihood * 100).toFixed(0)}%.`,
        link: `/author/papers/${paper.id}`,
      });
    } catch (aiErr) {
      logger.warn({ err: aiErr.message, paperId: paper.id }, 'GenAI pipeline failed');
    }

    res.redirect(`/author/papers/${paper.id}`);
  } catch (err) { next(err); }
}

async function paperDetail(req, res, next) {
  try {
    const paper = await Paper.findById(req.params.id);
    if (!paper || paper.author_id !== req.user.id) return res.status(404).render('error', { title: 'Not Found', message: 'Paper not found.' });
    const reviews = await Review.listByPaper(paper.id);
    const decisions = await Paper.decisionsForPaper(paper.id);
    res.render('author/paper', { title: paper.title, paper, reviews, decisions });
  } catch (err) { next(err); }
}

async function profile(req, res, next) {
  try {
    const user = await User.findById(req.user.id);
    const stats = await Paper.authorStats(req.user.id);
    const aiUsage = await all(
      `SELECT action, COUNT(*) AS n FROM ai_audit WHERE user_id = ? GROUP BY action ORDER BY n DESC`,
      [req.user.id]
    );
    res.render('author/profile', { title: 'Profile', user, stats, aiUsage });
  } catch (err) { next(err); }
}

async function updateProfile(req, res, next) {
  try {
    const { email, expertise, affiliation } = req.body;
    await User.updateProfile(req.user.id, { email, expertise, affiliation });
    res.redirect('/author/profile');
  } catch (err) { next(err); }
}

module.exports = { dashboard, showSubmit, submit, paperDetail, profile, updateProfile };
