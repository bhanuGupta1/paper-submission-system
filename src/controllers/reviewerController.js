'use strict';

const Paper = require('../models/Paper');
const Review = require('../models/Review');
const Discussion = require('../models/Discussion');
const N = require('../services/notifications');
const aiReviewer = require('../services/aiReviewer');
const logger = require('../utils/logger');

// Blind the paper for reviewer — hide author identity
function blindPaperForReviewer(paper) {
  return {
    ...paper,
    author_username: '[Anonymous]',
    authors: '[Blinded for double-blind review]',
    author_id: undefined,
  };
}

async function dashboard(req, res, next) {
  try {
    const assignments = await Review.listByReviewer(req.user.id);
    const stats = assignments.reduce((acc, r) => {
      acc.total += 1;
      if (r.recommendation) acc.completed += 1;
      else if (r.declined_at) acc.declined += 1;
      else acc.pending += 1;
      if (r.ai_assisted) acc.aiAssisted += 1;
      // Flag overdue
      if (!r.recommendation && !r.declined_at && r.deadline && new Date(r.deadline) < new Date()) acc.overdue += 1;
      return acc;
    }, { total: 0, completed: 0, pending: 0, declined: 0, aiAssisted: 0, overdue: 0 });
    stats.completionRate = stats.total ? Math.round((stats.completed / stats.total) * 100) : 0;
    res.render('reviewer/dashboard', { title: 'Reviewer dashboard', assignments, stats });
  } catch (err) { next(err); }
}

async function showReview(req, res, next) {
  try {
    const paper = await Paper.findById(req.params.paperId);
    const review = await Review.findByPaperReviewer(req.params.paperId, req.user.id);
    if (!paper || !review) {
      return res.status(404).render('errors/404', { title: 'Not Found', path: req.originalUrl });
    }
    if (review.declined_at) {
      return res.status(403).render('errors/403', { title: 'Assignment Declined', message: 'You have declined this review assignment.' });
    }
    const blindedPaper = blindPaperForReviewer(paper);
    const discussion = await Discussion.listByPaper(paper.id);
    res.render('reviewer/review', { title: `Review: ${paper.title}`, paper: blindedPaper, review, discussion });
  } catch (err) { next(err); }
}

async function aiDraft(req, res, next) {
  try {
    const paper = await Paper.findById(req.params.paperId);
    if (!paper) return res.status(404).json({ error: 'Paper not found' });
    const review = await Review.findByPaperReviewer(req.params.paperId, req.user.id);
    if (!review) return res.status(403).json({ error: 'Not assigned to this paper' });
    if (review.declined_at) return res.status(403).json({ error: 'Assignment declined' });
    const draft = await aiReviewer.draftReviewFor(paper, req.user.id);
    res.json(draft);
  } catch (err) { next(err); }
}

async function submit(req, res, next) {
  try {
    const review = await Review.findById(req.params.reviewId);
    if (!review || review.reviewer_id !== req.user.id) {
      return res.status(403).render('error', { title: 'Forbidden', message: 'Cannot submit this review.' });
    }
    if (review.declined_at) {
      return res.status(403).render('error', { title: 'Forbidden', message: 'Cannot submit a declined review.' });
    }
    const { summary, strengths, weaknesses, novelty_score, clarity_score, significance_score, recommendation, review_text, ai_assisted } = req.body;

    if (!summary || summary.trim().length < 20) {
      return res.status(400).render('error', { title: 'Incomplete review', message: 'Summary must be at least 20 characters.' });
    }
    if (!strengths || strengths.trim().length < 10) {
      return res.status(400).render('error', { title: 'Incomplete review', message: 'Strengths section must be at least 10 characters.' });
    }
    if (!weaknesses || weaknesses.trim().length < 10) {
      return res.status(400).render('error', { title: 'Incomplete review', message: 'Weaknesses section must be at least 10 characters.' });
    }

    // Validate scores
    const scores = [novelty_score, clarity_score, significance_score].map((s) => parseInt(s, 10));
    if (scores.some((s) => isNaN(s) || s < 1 || s > 5)) {
      return res.status(400).render('error', { title: 'Invalid scores', message: 'All scores must be between 1 and 5.' });
    }
    if (!['accept', 'minor_revisions', 'major_revisions', 'reject'].includes(recommendation)) {
      return res.status(400).render('error', { title: 'Invalid recommendation', message: 'Please select a valid recommendation.' });
    }

    await Review.submit(req.params.reviewId, {
      summary, strengths, weaknesses,
      novelty_score: scores[0], clarity_score: scores[1], significance_score: scores[2],
      recommendation, review_text,
      ai_assisted: ai_assisted === 'on' || ai_assisted === '1',
    });

    // Auto-update paper status based on all reviewers' recommendations
    const allReviews = await Review.listByPaper(review.paper_id);
    const submitted = allReviews.filter((r) => r.recommendation && !r.declined_at);
    const active = allReviews.filter((r) => !r.declined_at);
    if (submitted.length > 0 && submitted.length === active.length) {
      const recs = submitted.map((r) => r.recommendation);
      let status = 'revisions';
      if (recs.every((r) => r === 'accept')) status = 'accepted';
      else if (recs.every((r) => r === 'reject')) status = 'rejected';
      await Paper.updateStatus(review.paper_id, status);
      logger.info({ paperId: review.paper_id, status }, 'All reviews submitted — paper status auto-updated');
      // Notify editors/admins to make the official decision — do NOT send author a decision notification here
      const paper = await Paper.findById(review.paper_id);
      if (paper) {
        try {
          const { all: dbAll } = require('../db/connection');
          const editors = await dbAll("SELECT id FROM users WHERE role IN ('editor','admin') AND is_active = 1");
          for (const ed of editors) {
            await N.notify(ed.id, {
              kind: 'review',
              title: `All reviews in for "${paper.title}"`,
              body: `All assigned reviewers have submitted their assessments. Please review and make the editorial decision.`,
              link: `/editor`,
            });
          }
        } catch (notifErr) {
          logger.warn({ err: notifErr, paperId: review.paper_id }, 'Failed to notify editors of review completion');
        }
      }
    }

    res.redirect('/reviewer');
  } catch (err) { next(err); }
}

async function declineAssignment(req, res, next) {
  try {
    const review = await Review.findById(req.params.reviewId);
    if (!review || review.reviewer_id !== req.user.id) {
      return res.status(403).json({ error: 'Cannot decline this assignment' });
    }
    if (review.review_date) return res.status(400).json({ error: 'Cannot decline a completed review' });
    if (review.declined_at) return res.status(400).json({ error: 'Assignment already declined' });
    const reason = (req.body.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'Please provide a reason for declining' });

    await Review.decline(review.id, reason);
    logger.info({ reviewId: review.id, paperId: review.paper_id, reviewerId: req.user.id, reason }, 'Reviewer declined assignment');

    // Notify editors — fire-and-forget so notification failure does not un-decline the assignment
    try {
      const paper = await Paper.findById(review.paper_id);
      if (paper) {
        const { all: dbAll } = require('../db/connection');
        const editors = await dbAll("SELECT id FROM users WHERE role IN ('editor','admin') AND is_active = 1");
        for (const ed of editors) {
          await N.notify(ed.id, {
            kind: 'assignment',
            title: `Reviewer declined: "${paper.title}"`,
            body: `${req.user.username} declined their review assignment. Reason: ${reason.slice(0, 100)}`,
            link: `/editor`,
          });
        }
      }
    } catch (notifErr) {
      logger.warn({ err: notifErr, reviewId: review.id }, 'Failed to notify editors of reviewer decline');
    }

    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function declareCoi(req, res, next) {
  try {
    const { paperId } = req.params;
    const reason = (req.body.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'Please describe the conflict of interest' });

    const review = await Review.findByPaperReviewer(paperId, req.user.id);
    if (!review) return res.status(403).json({ error: 'You are not assigned to this paper' });

    await Review.declareCoi(paperId, req.user.id, reason);
    await Review.decline(review.id, `COI declared: ${reason}`);

    logger.info({ reviewerId: req.user.id, paperId, reason }, 'Reviewer declared COI');
    res.json({ ok: true, message: 'Conflict of interest recorded and assignment declined' });
  } catch (err) { next(err); }
}

async function postDiscussion(req, res, next) {
  try {
    const { paperId } = req.params;
    const review = await Review.findByPaperReviewer(paperId, req.user.id);
    if (!review) return res.status(403).json({ error: 'Not assigned to this paper' });
    const message = (req.body.message || '').trim();
    if (!message) return res.status(400).json({ error: 'Message cannot be empty' });
    if (message.length > 2000) return res.status(400).json({ error: 'Message too long (max 2000 characters)' });
    await Discussion.post({ paperId, authorId: req.user.id, message, parentId: req.body.parentId || null });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = { dashboard, showReview, aiDraft, submit, declineAssignment, declareCoi, postDiscussion };
