'use strict';

const config = require('../config');
const logger = require('../utils/logger');

const GLOBAL_WEBHOOK_URL = process.env.TEAMS_WEBHOOK_URL || '';

async function post(webhookUrl, payload) {
  if (!webhookUrl) return;
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, '[teams] Webhook returned non-OK status');
    }
  } catch (err) {
    logger.error({ err }, '[teams] Webhook delivery failed');
  }
}

function card(summary, title, subtitle, facts = [], actionUrl = null) {
  const payload = {
    '@type': 'MessageCard',
    '@context': 'https://schema.org/extensions',
    themeColor: '4F46E5',
    summary,
    sections: [
      {
        activityTitle: title,
        activitySubtitle: subtitle,
        facts,
      },
    ],
  };
  if (actionUrl) {
    payload.potentialAction = [
      {
        '@type': 'OpenUri',
        name: 'Open in PaperSub.AI',
        targets: [{ os: 'default', uri: actionUrl }],
      },
    ];
  }
  return payload;
}

function notifyNewSubmission({ paperId, title, author, submittedAt }, webhookUrl = GLOBAL_WEBHOOK_URL) {
  return post(webhookUrl, card(
    `New manuscript submitted: "${title}"`,
    `📄 New submission by **${author}**`,
    `"${title}"`,
    [
      { name: 'Paper ID', value: String(paperId) },
      { name: 'Submitted', value: new Date(submittedAt).toUTCString() },
    ],
    `${config.appUrl}/editor`,
  ));
}

function notifyDecision({ paperId, title, decision, editorUsername }, webhookUrl = GLOBAL_WEBHOOK_URL) {
  const emoji = { accepted: '✅', rejected: '❌', revisions: '📝', under_review: '🔍' }[decision] || '📋';
  const label = decision.replace('_', ' ').toUpperCase();
  return post(webhookUrl, card(
    `Editorial decision (${label}): "${title}"`,
    `${emoji} Decision: **${label}**`,
    `"${title}" · by **${editorUsername}**`,
    [{ name: 'Paper ID', value: String(paperId) }],
    `${config.appUrl}/editor`,
  ));
}

function notifyReviewAssigned({ paperId, paperTitle, reviewerUsername }, webhookUrl = GLOBAL_WEBHOOK_URL) {
  return post(webhookUrl, card(
    `Review assigned: "${paperTitle}"`,
    `🎯 Review assigned to **${reviewerUsername}**`,
    `"${paperTitle}"`,
    [{ name: 'Paper ID', value: String(paperId) }],
    `${config.appUrl}/reviewer`,
  ));
}

module.exports = {
  post,
  notifyNewSubmission,
  notifyDecision,
  notifyReviewAssigned,
  enabled: Boolean(GLOBAL_WEBHOOK_URL),
};
