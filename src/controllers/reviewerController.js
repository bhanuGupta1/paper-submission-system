'use strict';

const Paper = require('../models/Paper');
const Review = require('../models/Review');
const aiReviewer = require('../services/aiReviewer');

async function dashboard(req, res, next) {
  try {
    const papers = await Paper.listForReviewer(req.user.id);
    res.render('reviewer/dashboard', { title: 'Reviewer dashboard', papers });
  } catch (err) {
    next(err);
  }
}

async function showReview(req, res, next) {
  try {
    const paper = await Paper.findById(req.params.paperId);
    const review = await Review.findByPaperReviewer(req.params.paperId, req.user.id);
    if (!paper || !review) {
      return res.status(404).render('error', { title: 'Not Found', message: 'Review assignment not found.' });
    }
    res.render('reviewer/review', { title: `Review: ${paper.title}`, paper, review });
  } catch (err) {
    next(err);
  }
}

async function aiDraft(req, res, next) {
  try {
    const paper = await Paper.findById(req.params.paperId);
    if (!paper) return res.status(404).json({ error: 'Paper not found' });
    const review = await Review.findByPaperReviewer(req.params.paperId, req.user.id);
    if (!review) return res.status(403).json({ error: 'Not assigned to this paper' });
    const draft = await aiReviewer.draftReviewFor(paper, req.user.id);
    res.json(draft);
  } catch (err) {
    next(err);
  }
}

async function submit(req, res, next) {
  try {
    const review = await Review.findById(req.params.reviewId);
    if (!review || review.reviewer_id !== req.user.id) {
      return res.status(403).render('error', { title: 'Forbidden', message: 'Cannot submit this review.' });
    }
    const {
      summary, strengths, weaknesses, novelty_score, clarity_score,
      significance_score, recommendation, review_text, ai_assisted,
    } = req.body;
    await Review.submit(req.params.reviewId, {
      summary, strengths, weaknesses,
      novelty_score: parseInt(novelty_score, 10) || null,
      clarity_score: parseInt(clarity_score, 10) || null,
      significance_score: parseInt(significance_score, 10) || null,
      recommendation, review_text,
      ai_assisted: ai_assisted === 'on' || ai_assisted === '1' || ai_assisted === true,
    });
    // Auto-update paper status based on recommendations from all reviewers.
    const all = await Review.listByPaper(review.paper_id);
    const submitted = all.filter((r) => r.recommendation);
    if (submitted.length > 0 && submitted.length === all.length) {
      const recs = submitted.map((r) => r.recommendation);
      let status = 'revisions';
      if (recs.every((r) => r === 'accept')) status = 'accepted';
      else if (recs.every((r) => r === 'reject')) status = 'rejected';
      await Paper.updateStatus(review.paper_id, status);
    }
    res.redirect('/reviewer');
  } catch (err) {
    next(err);
  }
}

module.exports = { dashboard, showReview, aiDraft, submit };
