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

    // LLM-powered suggestions on top of heuristic checks
    const llm = require('../services/llm');
    let aiSuggestions = null;
    if (llm.providerName !== 'heuristic') {
      try {
        const polished = await llm.polishAbstract(text);
        if (polished && Array.isArray(polished.suggestions) && polished.suggestions.length) {
          aiSuggestions = polished.suggestions;
        }
      } catch (_) {}
    }

    await run('INSERT INTO ai_audit (user_id, action, provider) VALUES (?,?,?)', [req.user.id, 'writing_feedback', llm.providerName || 'heuristic']);

    res.json({ feedback, wordCount: wc, sentenceCount: sentences.length, aiSuggestions });
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

    // LLM-generated decision letter body
    const llm = require('../services/llm');
    let decisionLetter = null;
    if (llm.providerName !== 'heuristic') {
      try {
        decisionLetter = await llm.generateDecisionLetter(paper, submitted, suggestion, explanation);
      } catch (_) {}
    }

    await run('INSERT INTO ai_audit (user_id, paper_id, action, provider) VALUES (?,?,?,?)', [user.id, paperId, 'decision_draft', llm.providerName || 'heuristic']);

    res.json({ suggestion, confidence, explanation, reviewCount: submitted.length, recCounts, avgScore: parseFloat(avgScore.toFixed(2)), decisionLetter });
  } catch (err) { next(err); }
}

// ── Review summary (LLM) ──────────────────────────────────────────────────────

async function reviewSummary(req, res, next) {
  try {
    const { paperId } = req.params;
    const user = req.user || req.apiUser;
    if (!['editor', 'admin'].includes(user.role)) return res.status(403).json({ error: 'Editors and admins only' });

    const paper = await Paper.findById(paperId);
    if (!paper) return res.status(404).json({ error: 'Paper not found' });

    const reviews = await Review.listByPaper(paperId);
    const submitted = reviews.filter((r) => r.review_date && !r.declined_at);

    if (submitted.length === 0) return res.json({ summary: null, message: 'No completed reviews to summarize.' });

    const llm = require('../services/llm');
    const summary = await llm.summarizeReviews(paper, submitted);

    await run('INSERT INTO ai_audit (user_id, paper_id, action, provider) VALUES (?,?,?,?)', [user.id, paperId, 'review_summary', llm.providerName || 'heuristic']);

    res.json({ summary, reviewCount: submitted.length, provider: llm.providerName });
  } catch (err) { next(err); }
}

// ── Pre-submission desk rejection check ───────────────────────────────────────

async function preSubmissionCheck(req, res, next) {
  try {
    const { title, abstract, wordCount, sections, referenceCount, keywords: kw } = req.body;
    if (!abstract && !title) return res.status(400).json({ error: 'title or abstract required' });
    const llm = require('../services/llm');
    const result = await llm.deskRejectionCheck(title, abstract, wordCount, sections, referenceCount, !!kw);
    await run('INSERT INTO ai_audit (user_id, action, provider) VALUES (?,?,?)', [req.user.id, 'desk_rejection_check', llm.providerName]);
    if (!result) return res.json({ verdict: 'WARN', pass_fail: 'WARN', overall_score: 50, issues: [], ready_to_submit: true, confidence: 0, summary: 'AI check unavailable — manual review required.', provider: 'heuristic' });
    const verdict = result.verdict || result.pass_fail || (result.ready_to_submit === false ? 'FAIL' : result.overall_score >= 70 ? 'PASS' : 'WARN');
    res.json({ ...result, verdict, provider: llm.providerName });
  } catch (err) { next(err); }
}

// ── Ethics & compliance checker ───────────────────────────────────────────────

async function ethicsCheck(req, res, next) {
  try {
    const { title, abstract, fullText } = req.body;
    if (!abstract) return res.status(400).json({ error: 'abstract required' });
    const llm = require('../services/llm');
    const result = await llm.ethicsCheck(title, abstract, fullText);
    await run('INSERT INTO ai_audit (user_id, action, provider) VALUES (?,?,?)', [req.user.id, 'ethics_check', llm.providerName]);
    if (!result) return res.json({ verdict: 'WARN', compliance_score: 0, overall_risk: 'UNKNOWN', flags: [], issues: [], confidence: 0, summary: 'Ethics check unavailable.', provider: 'heuristic' });
    const verdict = result.verdict || (result.overall_risk === 'LOW' ? 'PASS' : result.overall_risk === 'HIGH' ? 'FAIL' : 'WARN');
    const flags = result.flags || result.issues || result.concerns || [];
    const summary = result.summary || result.message || '';
    res.json({ ...result, verdict, flags, summary, provider: llm.providerName });
  } catch (err) { next(err); }
}

// ── Citation hallucination detector ───────────────────────────────────────────

async function citationCheck(req, res, next) {
  try {
    const { references, abstract } = req.body;
    const text = references || abstract;
    if (!text || !text.trim()) return res.status(400).json({ error: 'references or abstract required' });
    const llm = require('../services/llm');
    const result = await llm.citationHallucinationCheck(text);
    await run('INSERT INTO ai_audit (user_id, action, provider) VALUES (?,?,?)', [req.user.id, 'citation_check', llm.providerName]);
    if (!result) return res.json({ suspectCitations: [], suspicious_citations: [], overall_risk: 'UNKNOWN', flagged_count: 0, confidence: 0, summary: 'Citation check unavailable.', provider: 'heuristic' });
    const suspectCitations = result.suspicious_citations || result.suspectCitations || result.flagged_citations || [];
    res.json({ ...result, suspectCitations, provider: llm.providerName });
  } catch (err) { next(err); }
}

// ── Academic tone improver ────────────────────────────────────────────────────

async function toneImprove(req, res, next) {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'text required' });
    if (text.length > 3000) return res.status(400).json({ error: 'Text too long (max 3000 chars)' });
    const llm = require('../services/llm');
    const result = await llm.toneImprove(text);
    await run('INSERT INTO ai_audit (user_id, action, provider) VALUES (?,?,?)', [req.user.id, 'tone_improve', llm.providerName]);
    if (!result) return res.json({ improved_text: text, changes_made: [], tone_score_before: 50, tone_score_after: 50, confidence: 0, provider: 'heuristic' });
    res.json({ ...result, provider: llm.providerName });
  } catch (err) { next(err); }
}

// ── Tone improve — SSE stream ─────────────────────────────────────────────────

async function toneImproveStream(req, res, next) {
  try {
    const { text } = req.query;
    if (!text || !text.trim()) { res.end(); return; }
    const llm = require('../services/llm');
    await run('INSERT INTO ai_audit (user_id, action, provider) VALUES (?,?,?)', [req.user.id, 'tone_improve_stream', llm.providerName]);
    await llm.streamToneImprove(decodeURIComponent(text), res);
  } catch (err) { next(err); }
}

// ── Writing quality scorer ────────────────────────────────────────────────────

async function writingScore(req, res, next) {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'text required' });
    const llm = require('../services/llm');
    const result = await llm.writingScore(text);
    await run('INSERT INTO ai_audit (user_id, action, provider) VALUES (?,?,?)', [req.user.id, 'writing_score', llm.providerName]);
    if (!result) return res.json({ overallScore: 5, dimensions: {}, improvements: [], summary: 'Writing score unavailable.', confidence: 0, provider: 'heuristic' });
    const overallScore = result.overallScore ?? result.overall_score ?? result.score ?? 5;
    const dimensions = result.dimensions || {};
    const improvements = result.improvements || result.suggestions || [];
    const summary = result.summary || result.overall_grade || '';
    res.json({ ...result, overallScore, dimensions, improvements, summary, provider: llm.providerName });
  } catch (err) { next(err); }
}

// ── Section-by-section feedback ───────────────────────────────────────────────

async function sectionFeedback(req, res, next) {
  try {
    const { sectionText, text: bodyText, sectionType } = req.body;
    const content = sectionText || bodyText;
    if (!content || !sectionType) return res.status(400).json({ error: 'text and sectionType required' });
    const allowed = ['introduction', 'methods', 'results', 'discussion', 'abstract', 'conclusion'];
    if (!allowed.includes(sectionType.toLowerCase())) return res.status(400).json({ error: 'Invalid sectionType' });
    const llm = require('../services/llm');
    const result = await llm.sectionFeedback(content, sectionType);
    await run('INSERT INTO ai_audit (user_id, action, provider) VALUES (?,?,?)', [req.user.id, 'section_feedback', llm.providerName]);
    if (!result) return res.json({ strengths: [], weaknesses: [], suggestions: [], summary: 'Section feedback unavailable.', confidence: 0, provider: 'heuristic' });
    const strengths   = result.strengths   || result.strong_points || [];
    const weaknesses  = result.weaknesses  || result.weak_points   || result.areas_for_improvement || [];
    const suggestions = result.suggestions || result.improvements  || result.specific_suggestions  || [];
    res.json({ ...result, strengths, weaknesses, suggestions, provider: llm.providerName });
  } catch (err) { next(err); }
}

// ── Review draft assistant ────────────────────────────────────────────────────

async function reviewAssist(req, res, next) {
  try {
    const { roughNotes, paperId } = req.body;
    if (!roughNotes || !roughNotes.trim()) return res.status(400).json({ error: 'roughNotes required' });
    const paper = paperId ? await Paper.findById(paperId) : null;
    const llm = require('../services/llm');
    const result = await llm.reviewAssist(roughNotes, paper?.title || '', paper?.abstract || '');
    await run('INSERT INTO ai_audit (user_id, paper_id, action, provider) VALUES (?,?,?,?)', [req.user.id, paperId || null, 'review_assist', llm.providerName]);
    if (!result) return res.json({ summary: '', strengths: '', weaknesses: '', recommendation: '', formatted_review: roughNotes, confidence: 0, provider: 'heuristic' });
    const summary    = result.summary    || result.structured_summary || result.formatted_review?.split('\n')[0] || '';
    const strengths  = result.strengths  || result.structured_strengths  || '';
    const weaknesses = result.weaknesses || result.structured_weaknesses || '';
    const recommendation = result.recommendation || '';
    res.json({ ...result, summary, strengths, weaknesses, recommendation, provider: llm.providerName });
  } catch (err) { next(err); }
}

// ── LLM review quality check ──────────────────────────────────────────────────

async function reviewQualityLlm(req, res, next) {
  try {
    const { reviewId } = req.params;
    const review = await Review.findById(reviewId);
    if (!review) return res.status(404).json({ error: 'Review not found' });
    const user = req.user || req.apiUser;
    if (!['admin', 'editor'].includes(user.role) && review.reviewer_id !== user.id) return res.status(403).json({ error: 'Forbidden' });
    const paper = await Paper.findById(review.paper_id);
    const heuristicResult = reviewQuality.assessReview(review, paper);
    const llm = require('../services/llm');
    const llmResult = await llm.reviewQualityLlm(review, paper?.title || '');
    await run('INSERT INTO ai_audit (user_id, paper_id, action, provider) VALUES (?,?,?,?)', [user.id, review.paper_id, 'review_quality_llm', llm.providerName]);
    const flatResult = llmResult || {};
    const score = flatResult.overall_quality_score ?? flatResult.score ?? heuristicResult.score ?? 50;
    const verdict = flatResult.quality_verdict ?? flatResult.verdict ?? flatResult.recommendation ?? heuristicResult.recommendation ?? 'needs_improvement';
    const issues = flatResult.issues || flatResult.concerns || heuristicResult.issues || [];
    const summary = flatResult.summary || flatResult.feedback_summary || '';
    res.json({ score, verdict, issues, summary, heuristic: heuristicResult, provider: llm.providerName });
  } catch (err) { next(err); }
}

// ── Author revision summarizer ────────────────────────────────────────────────

async function revisionSummary(req, res, next) {
  try {
    const { paperId } = req.params;
    const paper = await Paper.findById(paperId);
    if (!paper) return res.status(404).json({ error: 'Paper not found' });
    if (req.user.role !== 'author' && !['editor','admin'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    if (req.user.role === 'author' && paper.author_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    const reviews = await Review.listByPaper(paperId);
    const submitted = reviews.filter(r => r.review_date && !r.declined_at);
    if (!submitted.length) return res.json({ summary: null, message: 'No completed reviews yet.' });
    const reviewsText = submitted.map((r, i) => 'Reviewer ' + (i+1) + ':\n' + [r.summary, r.strengths, r.weaknesses].filter(Boolean).join('\n')).join('\n\n---\n\n');
    const llm = require('../services/llm');
    const result = await llm.revisionSummarizer(paper.title, reviewsText);
    await run('INSERT INTO ai_audit (user_id, paper_id, action, provider) VALUES (?,?,?,?)', [req.user.id, paperId, 'revision_summary', llm.providerName]);
    if (!result) return res.json({ summary: 'Please review the feedback manually.', mandatoryChanges: [], optionalChanges: [], themes: [], revision_checklist: [], overall_revision_effort: 'MODERATE', provider: 'heuristic' });
    const mandatoryChanges = result.mandatory_changes || result.mandatoryChanges || result.required_changes || result.revision_checklist || [];
    const optionalChanges  = result.optional_changes  || result.optionalChanges  || result.suggested_changes || [];
    res.json({ ...result, mandatoryChanges, optionalChanges, provider: llm.providerName });
  } catch (err) { next(err); }
}

// ── Response-to-reviewers assistant ──────────────────────────────────────────

async function responseToReviewers(req, res, next) {
  try {
    const { paperId } = req.params;
    const { comment, authorNotes } = req.body;
    const reviewerComment = comment || authorNotes || '';
    const paper = await Paper.findById(paperId);
    if (!paper) return res.status(404).json({ error: 'Paper not found' });
    if (req.user.role === 'author' && paper.author_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    const reviews = await Review.listByPaper(paperId);
    const submitted = reviews.filter(r => r.review_date && !r.declined_at);
    const reviewsText = submitted.map((r, i) => 'Reviewer ' + (i+1) + ':\n' + [r.summary, r.weaknesses].filter(Boolean).join('\n')).join('\n\n');
    const llm = require('../services/llm');
    const result = await llm.responseToReviewers(paper.title, reviewerComment || reviewsText);
    await run('INSERT INTO ai_audit (user_id, paper_id, action, provider) VALUES (?,?,?,?)', [req.user.id, paperId, 'response_to_reviewer', llm.providerName]);
    if (!result) return res.json({ responseDraft: '', draft_response: '', action_required: 'REVISED', confidence: 0, provider: 'heuristic' });
    const draft = result.draft_response || result.responseDraft || result.response || '';
    res.json({ ...result, responseDraft: draft, provider: llm.providerName });
  } catch (err) { next(err); }
}

// ── Analytics insights ────────────────────────────────────────────────────────

async function analyticsInsights(req, res, next) {
  try {
    const user = req.user;
    if (!['admin', 'editor'].includes(user.role)) return res.status(403).json({ error: 'Editors and admins only' });
    const ops = await require('../services/operationsAnalytics').getAdminAnalytics();
    const stats = {
      totalPapers: ops.statusBreakdown.reduce((a, b) => a + b.count, 0),
      statusBreakdown: ops.statusBreakdown,
      reviewCompletionRate: ops.reviewFunnel.completionRate,
      pendingReviews: ops.reviewFunnel.pending,
      averageScores: ops.reviewFunnel.averageScores,
      atRiskPapers: ops.atRiskPapers.length,
      integritySnapshot: ops.integritySnapshot,
    };
    const llm = require('../services/llm');
    const result = await llm.analyticsInsights(stats);
    await run('INSERT INTO ai_audit (user_id, action, provider) VALUES (?,?,?)', [user.id, 'analytics_insights', llm.providerName]);
    if (!result) return res.json({ insights: [], key_findings: [], action_items: [], trend_summary: 'AI insights unavailable.', provider: 'heuristic' });
    res.json({ ...result, provider: llm.providerName });
  } catch (err) { next(err); }
}

// ── Structured rubric generator ───────────────────────────────────────────────

async function generateRubric(req, res, next) {
  try {
    const { paperId } = req.params;
    const paper = await Paper.findById(paperId);
    if (!paper) return res.status(404).json({ error: 'Paper not found' });
    const paperType = req.query.type || 'empirical';
    const domain = paper.keywords || paper.tags || '';
    const llm = require('../services/llm');
    const result = await llm.generateRubric(paperType, domain, paper.abstract || '');
    await run('INSERT INTO ai_audit (user_id, paper_id, action, provider) VALUES (?,?,?,?)', [req.user.id, paperId, 'generate_rubric', llm.providerName]);
    if (!result) return res.json({ rubric_title: 'Standard Review Rubric', sections: [], overall_guidance: '', estimated_review_time_hours: 3, confidence: 0, provider: 'heuristic' });
    res.json({ ...result, provider: llm.providerName });
  } catch (err) { next(err); }
}

module.exports = {
  polish, titles, keywords, writingFeedback,
  checkReviewQuality, predictAcceptance, search,
  decisionDraft, reviewSummary,
  preSubmissionCheck, ethicsCheck, citationCheck,
  toneImprove, toneImproveStream, writingScore, sectionFeedback,
  reviewAssist, reviewQualityLlm,
  revisionSummary, responseToReviewers,
  analyticsInsights, generateRubric,
};
