'use strict';

const cron = require('node-cron');
const Review = require('../models/Review');
const User = require('../models/User');
const N = require('./notifications');
const emailService = require('./email');
const logger = require('../utils/logger');
const { all } = require('../db/connection');

async function sendReminders() {
  try {
    const overdue = await Review.listOverdue();
    logger.info({ count: overdue.length }, 'Deadline reminder check');

    for (const review of overdue) {
      if (review.reminder_sent) continue;

      await N.notify(review.reviewer_id, {
        kind: 'assignment',
        title: `Review overdue: "${review.paper_title}"`,
        body: `Your review was due ${review.deadline}. Please submit it as soon as possible.`,
        link: `/reviewer/papers/${review.paper_id}`,
      });

      if (review.reviewer_email && emailService) {
        const { subject, html, text } = emailService.reviewReminderEmail(review.reviewer_username, review.paper_title, review.deadline);
        emailService.send({ to: review.reviewer_email, subject, html, text }).catch((e) => logger.warn({ e }, 'Reminder email failed'));
      }

      await Review.markReminderSent(review.id);
    }

    // Also check upcoming deadlines (within 48 hours)
    const upcoming = await all(
      `SELECT r.id, r.paper_id, r.reviewer_id, r.deadline, r.reminder_sent,
              p.title AS paper_title, u.email AS reviewer_email, u.username AS reviewer_username
       FROM reviews r
       JOIN papers p ON p.id = r.paper_id
       JOIN users u ON u.id = r.reviewer_id
       WHERE r.review_date IS NULL AND r.declined_at IS NULL AND r.reminder_sent = 0
         AND r.deadline IS NOT NULL
         AND r.deadline > datetime('now')
         AND r.deadline <= datetime('now', '+48 hours')`
    );

    for (const review of upcoming) {
      await N.notify(review.reviewer_id, {
        kind: 'assignment',
        title: `Review due soon: "${review.paper_title}"`,
        body: `Your review is due ${review.deadline}. Please plan to submit within 48 hours.`,
        link: `/reviewer/papers/${review.paper_id}`,
      });
      await Review.markReminderSent(review.id);
    }
  } catch (err) {
    logger.error({ err }, 'Deadline reminder job failed');
  }
}

function start() {
  // Run daily at 8am
  cron.schedule('0 8 * * *', sendReminders);
  logger.info('Deadline reminder cron started (daily 08:00)');
}

module.exports = { start, sendReminders };
