'use strict';

const config = require('../config');
const logger = require('../utils/logger');

const WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';

async function post(payload) {
  if (!WEBHOOK_URL) return;
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, '[slack] Webhook returned non-OK status');
    }
  } catch (err) {
    logger.error({ err }, '[slack] Webhook delivery failed');
  }
}

function notifyNewSubmission({ paperId, title, author, submittedAt }) {
  return post({
    text: `📄 *New manuscript submitted* on PaperSub.AI`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `📄 *New submission by @${author}*\n*"${title}"*`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Submitted at ${new Date(submittedAt).toUTCString()} · Paper #${paperId} · <${config.appUrl}/editor|Open editor dashboard>`,
          },
        ],
      },
    ],
  });
}

function notifyDecision({ paperId, title, decision, editorUsername }) {
  const emoji = { accepted: '✅', rejected: '❌', revisions: '📝', under_review: '🔍' }[decision] || '📋';
  return post({
    text: `${emoji} *Editorial decision: ${decision.replace('_', ' ')}* for "${title}"`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${emoji} *${decision.replace('_', ' ').toUpperCase()}* — "${title}"\nDecision by @${editorUsername}`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Paper #${paperId} · <${config.appUrl}/editor|Open editor dashboard>`,
          },
        ],
      },
    ],
  });
}

function notifyReviewAssigned({ paperId, paperTitle, reviewerUsername }) {
  return post({
    text: `🎯 *Review assigned* — "${paperTitle}" → @${reviewerUsername}`,
  });
}

module.exports = {
  post,
  notifyNewSubmission,
  notifyDecision,
  notifyReviewAssigned,
  enabled: Boolean(WEBHOOK_URL),
};
