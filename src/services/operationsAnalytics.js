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

module.exports = {
  getStatusBreakdown,
  getReviewFunnel,
  getIntegritySnapshot,
  getAtRiskPapers,
  getAdminAnalytics,
};
