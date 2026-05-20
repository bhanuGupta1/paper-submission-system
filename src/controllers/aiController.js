'use strict';

const writingAssistant = require('../services/writingAssistant');
const reviewQuality = require('../services/reviewQuality');
const acceptancePredictor = require('../services/acceptancePredictor');
const smartSearch = require('../services/smartSearch');
const aiReviewer = require('../services/aiReviewer');
const Paper = require('../models/Paper');
const Review = require('../models/Review');
const { run } = require('../db/connection');

// ── Writing assistant ─────────────────────────────────────────────────────────

async function polish(req, res, next) {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'text is required' });
    if (text.length > 5000) return res.status(400).json({ error: 'Text too long (max 5000 chars)' });
    const out = await writingAssistant.polish(text, req.user.id);
    res.json(out);
  } catch (err) { next(err); }
}

async function titles(req, res, next) {
  try {
    const { abstract } = req.body;
    if (!abstract || !abstract.trim()) return res.status(400).json({ error: 'abstract is required' });
    if (abstract.length > 3000) return res.status(400).json({ error: 'Abstract too long (max 3000 chars)' });
    const out = await writingAssistant.titles(abstract, req.user.id, 3);
    res.json({ titles: out });
  } catch (err) { next(err); }
}

async function keywords(req, res, next) {
  try {
    const { abstract } = req.body;
    if (!abstract || !abstract.trim()) return res.status(400).json({ error: 'abstract is required' });
    const out = await writingAssistant.keywords(abstract, req.user.id, 6);
    res.json({ keywords: out });
  } catch (err) { next(err); }
}

// ── Writing quality feedback ──────────────────────────────────────────────────

async function writingFeedback(req, res, next) {
  try {
    const { text, type = 'abstract' } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'text is required' });

    const feedback = [];
    const wc = text.trim().split(/\s+/).length;

    if (type === 'abstract') {
      if (wc < 80) feedback.push({ level: 'error', message: `Abstract is too short (${wc} words). Aim for 150-250 words.` });
      else if (wc > 300) feedback.push({ level: 'warning', message: `Abstract is long (${wc} words). Consider trimming to under 250.` });
      else feedback.push({ level: 'success', message: `Good length (${wc} words).` });

      if (!/\b(we |this paper|this work|this study)\b/i.test(text)) feedback.push({ level: 'warning', message: 'State the contribution explicitly (e.g., "We propose...", "This paper presents...").' });
      if (!/\b(result|finding|show|demonstrate|achieve|outperform|improve)\b/i.test(text)) feedback.push({ level: 'error', message: 'Missing: state the key result or evaluation outcome.' });
      if (!/\b(dataset|experiment|baseline|benchmark|evaluation|evaluat)\b/i.test(text)) feedback.push({ level: 'warning', message: 'Consider mentioning the evaluation methodology or dataset.' });
      if (/\b(very|really|basically|actually|just|in order to)\b/i.test(text)) feedback.push({ level: 'info', message: 'Remove filler words: very, really, basically, actually, just.' });
      if (/\b(etc\.|and so on|and others)\b/i.test(text)) feedback.push({ level: 'info', message: 'Avoid vague endings like "etc." — be specific.' });
    }

    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 5);
    const avgSentLen = wc / Math.max(1, sentences.length);
    if (avgSentLen > 35) feedback.push({ level: 'warning', message: `Average sentence length is ${avgSentLen.toFixed(0)} words — consider breaking up long sentences.` });

    // Passive voice detection (simple heuristic)
    const passiveMatches = (text.match(/\b(is|are|was|were|be|been|being)\s+\w+ed\b/gi) || []).length;
    if (passiveMatches > 3) feedback.push({ level: 'info', message: `Passive voice detected ${passiveMatches} times. Active voice is often clearer.` });

    await run('INSERT INTO ai_audit (user_id, action, provider) VALUES (?,?,?)', [req.user.id, 'writing_feedback', 'heuristic']);

    res.json({ feedback, wordCount: wc, sentenceCount: sentences.length });
  } catch (err) { next(err); }
}

// ── Review quality ────────────────────────────────────────────────────────────

async function checkReviewQuality(req, res, next) {
  try {
    const { reviewId } = req.params;
    const review = await Review.findById(reviewId);
    if (!review) return res.status(404).json({ error: 'Review not found' });

    // Only admins/editors can check any review; reviewers can only check their own
    const user = req.user || req.apiUser;
    if (!['admin', 'editor'].includes(user.role) && review.reviewer_id !== user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const paper = await Paper.findById(review.paper_id);
    const result = reviewQuality.assessReview(review, paper);

    await run('INSERT INTO ai_audit (user_id, paper_id, action, provider) VALUES (?,?,?,?)', [user.id, review.paper_id, 'review_quality_check', 'heuristic']);

    res.json(result);
  } catch (err) { next(err); }
}

// ── Acceptance predictor ─────────────────────────────────────────────────────

async function predictAcceptance(req, res, next) {
  try {
    const { paperId } = req.params;
    const paper = await Paper.findById(paperId);
    if (!paper) return res.status(404).json({ error: 'Paper not found' });

    const user = req.user || req.apiUser;
    if (!['admin', 'editor'].includes(user.role)) return res.status(403).json({ error: 'Editors and admins only' });

    const result = await acceptancePredictor.predict(paperId);
    await run('INSERT INTO ai_audit (user_id, paper_id, action, provider) VALUES (?,?,?,?)', [user.id, paperId, 'acceptance_prediction', 'heuristic']);
    res.json(result);
  } catch (err) { next(err); }
}

// ── Smart search ─────────────────────────────────────────────────────────────

async function search(req, res, next) {
  try {
    const { q, status, trackId, limit = 20 } = req.query;
    const user = req.user || req.apiUser;

    // Authors can only search their own papers (unless editor/admin)
    const authorId = ['author', 'reviewer', 'reader'].includes(user.role) ? user.id : null;
    const effectiveAuthorId = ['author'].includes(user.role) ? user.id : null;

    const results = await smartSearch.search(q || '', {
      status: status || null,
      trackId: trackId ? parseInt(trackId, 10) : null,
      limit: Math.min(50, parseInt(limit, 10) || 20),
      authorId: ['editor', 'admin'].includes(user.role) ? null : effectiveAuthorId,
    });

    res.json({ results, query: q || null, total: results.length });
  } catch (err) { next(err); }
}

// ── AI decision draft ─────────────────────────────────────────────────────────

async function decisionDraft(req, res, next) {
  try {
    const { paperId } = req.params;
    const user = req.user || req.apiUser;
    if (!['editor', 'admin'].includes(user.role)) return res.status(403).json({ error: 'Editors and admins only' });

    const paper = await Paper.findById(paperId);
    if (!paper) return res.status(404).json({ error: 'Paper not found' });

    const reviews = await Review.listByPaper(paperId);
    const submitted = reviews.filter((r) => r.review_date && !r.declined_at);

    if (submitted.length === 0) return res.json({ suggestion: 'no_reviews', explanation: ['No completed reviews available.'], confidence: 'none' });

    // Compute recommendation consensus
    const recCounts = submitted.reduce((acc, r) => { acc[r.recommendation] = (acc[r.recommendation] || 0) + 1; return acc; }, {});
    const total = submitted.length;
    const acceptCount = recCounts['accept'] || 0;
    const rejectCount = recCounts['reject'] || 0;
    const minorCount = recCounts['minor_revisions'] || 0;
    const majorCount = recCounts['major_revisions'] || 0;

    const scores = submitted.map((r) => [r.novelty_score, r.clarity_score, r.significance_score]).flat().filter(Boolean);
    const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 3;

    const explanation = [];
    let suggestion, confidence;

    if (acceptCount / total >= 0.67 && avgScore >= 3.8) {
      suggestion = 'accepted'; confidence = 'high';
      explanation.push(`${acceptCount}/${total} reviewers recommend accept.`);
      explanation.push(`Average score: ${avgScore.toFixed(1)}/5.0.`);
    } else if (rejectCount / total >= 0.67 && avgScore <= 2.5) {
      suggestion = 'rejected'; confidence = 'high';
      explanation.push(`${rejectCount}/${total} reviewers recommend reject.`);
      explanation.push(`Average score: ${avgScore.toFixed(1)}/5.0.`);
    } else if ((minorCount + acceptCount) / total >= 0.67 && avgScore >= 3.5) {
      suggestion = 'revisions'; confidence = 'medium';
      explanation.push(`${minorCount + acceptCount}/${total} reviewers recommend accept or minor revisions.`);
    } else if ((majorCount + rejectCount) / total >= 0.67) {
      suggestion = 'rejected'; confidence = 'medium';
      explanation.push(`${majorCount + rejectCount}/${total} reviewers recommend major revisions or reject.`);
    } else {
      suggestion = 'revisions'; confidence = 'low';
      explanation.push('Mixed reviewer recommendations — revision suggested by default.');
    }

    if (paper.similarity_score > 0.8) explanation.push('⚠ High similarity score — verify originality before accepting.');
    if (paper.ai_text_likelihood > 0.8) explanation.push('⚠ High AI-text likelihood — review integrity policy.');

    await run('INSERT INTO ai_audit (user_id, paper_id, action, provider) VALUES (?,?,?,?)', [user.id, paperId, 'decision_draft', 'heuristic']);

    res.json({ suggestion, confidence, explanation, reviewCount: submitted.length, recCounts, avgScore: parseFloat(avgScore.toFixed(2)) });
  } catch (err) { next(err); }
}

module.exports = { polish, titles, keywords, writingFeedback, checkReviewQuality, predictAcceptance, search, decisionDraft };
