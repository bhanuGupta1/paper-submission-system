'use strict';

/**
 * Weekly editorial digest email.
 * Sent every Monday at 08:00 to all active editors with:
 *   - Pending papers awaiting assignment
 *   - Overdue reviews (past deadline)
 *   - Papers awaiting decision (all reviews complete)
 *   - Submission count for the past 7 days
 */

const { all, get } = require('../db/connection');
const emailService = require('./email');
const config = require('../config');
const logger = require('../utils/logger');

async function buildDigestPayload() {
  const [pending, overdue, awaitingDecision, weekSubmissions] = await Promise.all([
    all(`SELECT id, title, authors, submission_date FROM papers
         WHERE review_status = 'pending' ORDER BY submission_date ASC LIMIT 10`),
    all(`SELECT r.paper_id, p.title, r.deadline, u.username AS reviewer
         FROM reviews r
         JOIN papers p ON p.id = r.paper_id
         JOIN users u ON u.id = r.reviewer_id
         WHERE r.review_date IS NULL AND r.deadline IS NOT NULL AND r.deadline < date('now') AND r.declined_at IS NULL
         ORDER BY r.deadline ASC LIMIT 10`),
    all(`SELECT p.id, p.title,
              COUNT(r.id) AS total_reviews,
              SUM(CASE WHEN r.review_date IS NOT NULL THEN 1 ELSE 0 END) AS done
         FROM papers p
         JOIN reviews r ON r.paper_id = p.id
         WHERE p.review_status = 'under_review'
         GROUP BY p.id
         HAVING total_reviews > 0 AND total_reviews = done
         LIMIT 10`),
    get(`SELECT COUNT(*) AS n FROM papers WHERE submission_date >= date('now', '-7 days')`),
  ]);

  return { pending, overdue, awaitingDecision, weekSubmissions: weekSubmissions ? weekSubmissions.n : 0 };
}

function buildDigestHtml(editorName, payload) {
  const { pending, overdue, awaitingDecision, weekSubmissions } = payload;
  const appUrl = config.appUrl || 'http://localhost:3000';

  const rows = (items, fn) => items.length === 0
    ? '<tr><td colspan="3" style="padding:8px;color:#64748b;font-style:italic">None</td></tr>'
    : items.map(fn).join('');

  return `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;background:#f8fafc;color:#0f172a;padding:24px;max-width:600px;margin:0 auto">
  <div style="background:linear-gradient(135deg,#6366f1,#06b6d4);border-radius:12px;padding:24px;margin-bottom:24px;color:white">
    <h1 style="margin:0;font-size:22px">PaperSub.AI — Weekly digest</h1>
    <p style="margin:6px 0 0;opacity:0.85">Hi ${editorName} — here's your editorial summary for the past week.</p>
  </div>

  <div style="background:white;border-radius:8px;padding:16px;margin-bottom:16px;border:1px solid #e2e8f0">
    <p style="margin:0;font-size:14px;color:#64748b"><strong style="color:#0f172a;font-size:28px">${weekSubmissions}</strong> new submissions this week</p>
  </div>

  <div style="background:white;border-radius:8px;padding:16px;margin-bottom:16px;border:1px solid #e2e8f0">
    <h2 style="margin:0 0 12px;font-size:16px">Pending assignment (${pending.length})</h2>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      ${rows(pending, (p) => `<tr style="border-bottom:1px solid #f1f5f9">
        <td style="padding:8px 8px 8px 0"><a href="${appUrl}/editor" style="color:#6366f1">${p.title}</a></td>
        <td style="padding:8px;color:#64748b">${new Date(p.submission_date).toLocaleDateString()}</td>
      </tr>`)}
    </table>
  </div>

  <div style="background:white;border-radius:8px;padding:16px;margin-bottom:16px;border:1px solid #e2e8f0">
    <h2 style="margin:0 0 12px;font-size:16px;color:#dc2626">Overdue reviews (${overdue.length})</h2>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      ${rows(overdue, (r) => `<tr style="border-bottom:1px solid #f1f5f9">
        <td style="padding:8px 8px 8px 0"><a href="${appUrl}/editor" style="color:#6366f1">${r.title}</a></td>
        <td style="padding:8px;color:#64748b">${r.reviewer}</td>
        <td style="padding:8px;color:#dc2626">${r.deadline}</td>
      </tr>`)}
    </table>
  </div>

  <div style="background:white;border-radius:8px;padding:16px;margin-bottom:24px;border:1px solid #e2e8f0">
    <h2 style="margin:0 0 12px;font-size:16px;color:#059669">Ready for decision (${awaitingDecision.length})</h2>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      ${rows(awaitingDecision, (p) => `<tr style="border-bottom:1px solid #f1f5f9">
        <td style="padding:8px 8px 8px 0"><a href="${appUrl}/editor" style="color:#6366f1">${p.title}</a></td>
        <td style="padding:8px;color:#64748b">${p.done}/${p.total_reviews} reviews</td>
      </tr>`)}
    </table>
  </div>

  <p style="text-align:center">
    <a href="${appUrl}/editor" style="background:#6366f1;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-size:13px">Open dashboard →</a>
  </p>
  <p style="text-align:center;margin-top:16px;font-size:11px;color:#94a3b8">You receive this digest because you are an editor on PaperSub.AI. Manage your notification preferences in your profile settings.</p>
</body>
</html>`;
}

async function sendDigests() {
  try {
    const editors = await all(`SELECT id, username, email, notification_prefs FROM users WHERE role IN ('editor','admin') AND is_active = 1 AND email IS NOT NULL`);
    if (editors.length === 0) return;

    const payload = await buildDigestPayload();

    for (const editor of editors) {
      let prefs = {};
      try { prefs = JSON.parse(editor.notification_prefs || '{}'); } catch (_) {}
      if (prefs.digest === 'none') continue;

      try {
        await emailService.send({
          to: editor.email,
          subject: `PaperSub.AI weekly digest — ${new Date().toLocaleDateString('en', { month: 'short', day: 'numeric' })}`,
          html: buildDigestHtml(editor.username, payload),
          text: `PaperSub.AI weekly digest for ${editor.username}. ${payload.weekSubmissions} new submissions. ${payload.pending.length} pending assignment. ${payload.overdue.length} overdue reviews. ${payload.awaitingDecision.length} ready for decision. Open ${config.appUrl}/editor`,
        });
        logger.info({ to: editor.email }, '[digest] Sent weekly digest');
      } catch (err) {
        logger.error({ err, to: editor.email }, '[digest] Failed to send digest');
      }
    }
  } catch (err) {
    logger.error({ err }, '[digest] Failed to build digest payload');
  }
}

module.exports = { sendDigests };
