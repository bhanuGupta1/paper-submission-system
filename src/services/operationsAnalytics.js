'use strict';

const { all, get } = require('../db/connection');

const REVIEW_STATUSES = ['pending', 'under_review', 'revisions', 'accepted', 'rejected'];

function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function num(value) {
  return Number(value || 0);
}

async function getStatusBreakdown() {
  const rows = await all(`
    SELECT review_status AS status, COUNT(*) AS count
    FROM papers
    GROUP BY review_status
  `);
  const byStatus = Object.fromEntries(REVIEW_STATUSES.map((status) => [status, 0]));
  rows.forEach((row) => {
    byStatus[row.status] = num(row.count);
  });
  const total = Object.values(byStatus).reduce((sum, value) => sum + value, 0);
  return REVIEW_STATUSES.map((status) => ({
    status,
    count: byStatus[status],
    percent: pct(byStatus[status], total),
  }));
}

async function getReviewFunnel() {
  const row = await get(`
    SELECT
      COUNT(*) AS assignments,
      SUM(CASE WHEN review_date IS NOT NULL THEN 1 ELSE 0 END) AS completed,
      AVG(CASE WHEN review_date IS NOT NULL THEN novelty_score END) AS novelty,
      AVG(CASE WHEN review_date IS NOT NULL THEN clarity_score END) AS clarity,
      AVG(CASE WHEN review_date IS NOT NULL THEN significance_score END) AS significance
    FROM reviews
  `);
  const assignments = num(row && row.assignments);
  const completed = num(row && row.completed);
  return {
    assignments,
    completed,
    pending: Math.max(assignments - completed, 0),
    completionRate: pct(completed, assignments),
    averageScores: {
      novelty: row && row.novelty ? Number(row.novelty).toFixed(1) : 'n/a',
      clarity: row && row.clarity ? Number(row.clarity).toFixed(1) : 'n/a',
      significance: row && row.significance ? Number(row.significance).toFixed(1) : 'n/a',
    },
  };
}

async function getIntegritySnapshot() {
  const row = await get(`
    SELECT
      COUNT(*) AS papers,
      SUM(CASE WHEN similarity_score >= 0.5 THEN 1 ELSE 0 END) AS high_similarity,
      SUM(CASE WHEN ai_text_likelihood >= 0.5 THEN 1 ELSE 0 END) AS high_ai_likelihood,
      AVG(similarity_score) AS avg_similarity,
      AVG(ai_text_likelihood) AS avg_ai_likelihood
    FROM papers
  `);
  const papers = num(row && row.papers);
  return {
    papers,
    highSimilarity: num(row && row.high_similarity),
    highAiLikelihood: num(row && row.high_ai_likelihood),
    avgSimilarity: pct(row && row.avg_similarity, 1),
    avgAiLikelihood: pct(row && row.avg_ai_likelihood, 1),
  };
}

async function getAtRiskPapers(limit = 5) {
  return all(`
    SELECT p.id, p.title, p.review_status, p.submission_date,
           p.similarity_score, p.ai_text_likelihood,
           u.username AS author_username,
           COUNT(r.id) AS assignment_count,
           SUM(CASE WHEN r.review_date IS NOT NULL THEN 1 ELSE 0 END) AS completed_reviews
    FROM papers p
    LEFT JOIN users u ON u.id = p.author_id
    LEFT JOIN reviews r ON r.paper_id = p.id
    WHERE p.review_status IN ('pending', 'under_review', 'revisions')
    GROUP BY p.id
    ORDER BY
      CASE WHEN COUNT(r.id) = 0 THEN 1 ELSE 0 END DESC,
      MAX(p.similarity_score, p.ai_text_likelihood) DESC,
      p.submission_date ASC
    LIMIT ?
  `, [limit]);
}

async function getAdminAnalytics() {
  const [statusBreakdown, reviewFunnel, integritySnapshot, atRiskPapers] = await Promise.all([
    getStatusBreakdown(),
    getReviewFunnel(),
    getIntegritySnapshot(),
    getAtRiskPapers(),
  ]);
  return { statusBreakdown, reviewFunnel, integritySnapshot, atRiskPapers };
}

// Monthly submission counts for the past 12 months
async function getSubmissionTrends() {
  const rows = await all(`
    SELECT strftime('%Y-%m', submission_date) AS month, COUNT(*) AS count
    FROM papers
    WHERE submission_date >= date('now', '-12 months')
    GROUP BY month
    ORDER BY month ASC
  `);
  return rows.map((r) => ({ month: r.month, count: num(r.count) }));
}

// Monthly accepted vs rejected for past 12 months
async function getDecisionTrends() {
  const rows = await all(`
    SELECT strftime('%Y-%m', submission_date) AS month,
           SUM(CASE WHEN review_status = 'accepted' THEN 1 ELSE 0 END) AS accepted,
           SUM(CASE WHEN review_status = 'rejected' THEN 1 ELSE 0 END) AS rejected
    FROM papers
    WHERE submission_date >= date('now', '-12 months')
    GROUP BY month
    ORDER BY month ASC
  `);
  return rows.map((r) => ({ month: r.month, accepted: num(r.accepted), rejected: num(r.rejected) }));
}

// Per-reviewer stats: name, assigned, completed, avg scores, avg turnaround days
async function getReviewerPerformance(limit = 20) {
  return all(`
    SELECT u.id, u.username,
           COUNT(r.id) AS assigned,
           SUM(CASE WHEN r.review_date IS NOT NULL THEN 1 ELSE 0 END) AS completed,
           ROUND(AVG(CASE WHEN r.review_date IS NOT NULL THEN r.novelty_score END), 1) AS avg_novelty,
           ROUND(AVG(CASE WHEN r.review_date IS NOT NULL THEN r.clarity_score END), 1) AS avg_clarity,
           ROUND(AVG(CASE WHEN r.review_date IS NOT NULL THEN r.significance_score END), 1) AS avg_significance,
           ROUND(AVG(CASE WHEN r.review_date IS NOT NULL
             THEN CAST((julianday(r.review_date) - julianday(r.assigned_at)) AS REAL)
           END), 1) AS avg_days
    FROM reviews r
    JOIN users u ON u.id = r.reviewer_id
    GROUP BY u.id
    ORDER BY completed DESC, assigned DESC
    LIMIT ?
  `, [limit]);
}

// Overall turnaround stats
async function getTurnaroundStats() {
  const row = await get(`
    SELECT
      ROUND(AVG(CASE WHEN r.review_date IS NOT NULL
        THEN julianday(r.review_date) - julianday(p.submission_date) END), 1) AS avg_days_to_review,
      ROUND(AVG(CASE WHEN d.created_at IS NOT NULL
        THEN julianday(d.created_at) - julianday(p.submission_date) END), 1) AS avg_days_to_decision,
      SUM(CASE WHEN p.review_status = 'accepted' THEN 1 ELSE 0 END) AS total_accepted,
      SUM(CASE WHEN p.review_status = 'rejected' THEN 1 ELSE 0 END) AS total_rejected,
      COUNT(DISTINCT p.id) AS total
    FROM papers p
    LEFT JOIN reviews r ON r.paper_id = p.id
    LEFT JOIN decisions d ON d.paper_id = p.id AND d.to_status IN ('accepted','rejected')
  `);
  const total = num(row && row.total);
  const accepted = num(row && row.total_accepted);
  const rejected = num(row && row.total_rejected);
  return {
    avgDaysToReview: row && row.avg_days_to_review ? Number(row.avg_days_to_review) : null,
    avgDaysToDecision: row && row.avg_days_to_decision ? Number(row.avg_days_to_decision) : null,
    acceptanceRate: pct(accepted, accepted + rejected),
    rejectionRate: pct(rejected, accepted + rejected),
    totalAccepted: accepted,
    totalRejected: rejected,
    total,
  };
}

async function getEditorAnalytics() {
  const [submissionTrends, decisionTrends, reviewerPerformance, turnaroundStats, statusBreakdown] = await Promise.all([
    getSubmissionTrends(),
    getDecisionTrends(),
    getReviewerPerformance(),
    getTurnaroundStats(),
    getStatusBreakdown(),
  ]);
  return { submissionTrends, decisionTrends, reviewerPerformance, turnaroundStats, statusBreakdown };
}

module.exports = {
  getStatusBreakdown,
  getReviewFunnel,
  getIntegritySnapshot,
  getAtRiskPapers,
  getAdminAnalytics,
  getSubmissionTrends,
  getDecisionTrends,
  getReviewerPerformance,
  getTurnaroundStats,
  getEditorAnalytics,
};
