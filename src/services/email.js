'use strict';

const nodemailer = require('nodemailer');
const config = require('../config');
const logger = require('../utils/logger');

let _transport = null;

function getTransport() {
  if (_transport) return _transport;
  if (!config.email.enabled) return null;
  _transport = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.secure,
    auth: config.email.user
      ? { user: config.email.user, pass: config.email.pass }
      : undefined,
  });
  return _transport;
}

async function send({ to, subject, html, text, attachments }) {
  const transport = getTransport();
  if (!transport) {
    logger.info({ to, subject }, '[email] Email disabled — would have sent');
    return { simulated: true };
  }
  try {
    const info = await transport.sendMail({ from: config.email.from, to, subject, html, text, attachments });
    logger.info({ to, subject, messageId: info.messageId }, '[email] Sent');
    return info;
  } catch (err) {
    logger.error({ err, to, subject }, '[email] Send failed');
    throw err;
  }
}

function buildIcsAttachment(summary, description, dtstart, dtend, uid) {
  const fmt = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const now = fmt(new Date());
  const start = fmt(new Date(dtstart));
  const end = dtend ? fmt(new Date(dtend)) : start;
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PaperSub.AI//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}@papersub.ai`,
    `DTSTAMP:${now}Z`,
    `DTSTART;VALUE=DATE:${start.slice(0, 8)}`,
    `DTEND;VALUE=DATE:${end.slice(0, 8)}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description.replace(/\n/g, '\\n')}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  return { filename: 'review-deadline.ics', content: ics, contentType: 'text/calendar' };
}

function verificationEmail(username, token) {
  const url = `${config.appUrl}/auth/verify-email?token=${token}`;
  return {
    subject: 'Verify your PaperSub account',
    html: `<p>Hi ${username},</p>
<p>Click below to verify your email address:</p>
<p><a href="${url}">${url}</a></p>
<p>This link expires in 24 hours.</p>`,
    text: `Hi ${username},\n\nVerify your email: ${url}\n\nExpires in 24 hours.`,
  };
}

function passwordResetEmail(username, token) {
  const url = `${config.appUrl}/auth/reset-password?token=${token}`;
  return {
    subject: 'Reset your PaperSub password',
    html: `<p>Hi ${username},</p>
<p>Click below to reset your password:</p>
<p><a href="${url}">${url}</a></p>
<p>This link expires in 1 hour. If you did not request this, ignore this email.</p>`,
    text: `Hi ${username},\n\nReset your password: ${url}\n\nExpires in 1 hour.`,
  };
}

function submissionStatusEmail(username, paperTitle, status, link) {
  return {
    subject: `Paper status update: ${status.toUpperCase()}`,
    html: `<p>Hi ${username},</p>
<p>Your paper "<strong>${paperTitle}</strong>" has a new status: <strong>${status}</strong>.</p>
<p><a href="${config.appUrl}${link}">View details</a></p>`,
    text: `Hi ${username},\n\nYour paper "${paperTitle}" status: ${status}.\n\n${config.appUrl}${link}`,
  };
}

function reviewReminderEmail(username, paperTitle, deadline) {
  return {
    subject: `Review reminder: "${paperTitle}" due ${deadline}`,
    html: `<p>Hi ${username},</p>
<p>This is a reminder that your review for "<strong>${paperTitle}</strong>" is due on <strong>${deadline}</strong>.</p>
<p><a href="${config.appUrl}/reviewer">Go to reviewer dashboard</a></p>`,
    text: `Hi ${username},\n\nReview reminder for "${paperTitle}" due ${deadline}.\n\n${config.appUrl}/reviewer`,
  };
}

function reviewAssignmentEmail(username, paperTitle, paperId, deadline) {
  const link = `${config.appUrl}/reviewer/papers/${paperId}`;
  const dueLine = deadline ? `\n<p>Review due: <strong>${deadline}</strong></p>` : '';
  const attachments = [];
  if (deadline) {
    try {
      const uid = `review-${paperId}-${Date.now()}`;
      const ics = buildIcsAttachment(
        `Review deadline: ${paperTitle}`,
        `You are assigned to review "${paperTitle}". Open: ${link}`,
        deadline,
        deadline,
        uid,
      );
      attachments.push(ics);
    } catch (_) { /* ics generation is best-effort */ }
  }
  return {
    subject: `Review assignment: "${paperTitle}"`,
    html: `<p>Hi ${username},</p>
<p>You have been assigned to review the manuscript "<strong>${paperTitle}</strong>".</p>${dueLine}
<p><a href="${link}">Open the manuscript</a></p>
${deadline ? '<p style="color:#64748b;font-size:0.875rem">A calendar event (.ics) is attached — open it to add the deadline to Outlook, Google Calendar, or Apple Calendar.</p>' : ''}
<p style="color:#64748b;font-size:0.875rem">If you have a conflict of interest or are unable to complete this review, please decline via the review dashboard.</p>`,
    text: `Hi ${username},\n\nYou have been assigned to review "${paperTitle}".${deadline ? `\nDue: ${deadline}` : ''}\n\n${link}`,
    attachments,
  };
}

function submissionConfirmedEmail(username, paperTitle, paperId) {
  const link = `${config.appUrl}/author/papers/${paperId}`;
  return {
    subject: `Submission received: "${paperTitle}"`,
    html: `<p>Hi ${username},</p>
<p>We have received your manuscript "<strong>${paperTitle}</strong>". Our editorial team will review it shortly.</p>
<p><a href="${link}">Track your submission</a></p>`,
    text: `Hi ${username},\n\nYour manuscript "${paperTitle}" has been received.\n\n${link}`,
  };
}

function reviewerInvitationEmail(inviterUsername, paperTitle, inviteUrl) {
  return {
    subject: `Invitation to review: "${paperTitle}"`,
    html: `<p>You have been invited by <strong>${inviterUsername}</strong> to peer-review the manuscript "<strong>${paperTitle}</strong>" on PaperSub.AI.</p>
<p><a href="${inviteUrl}">Accept invitation and create account</a></p>
<p style="color:#64748b;font-size:0.875rem">This invitation expires in 7 days. If you did not expect this, you can ignore it.</p>`,
    text: `You have been invited by ${inviterUsername} to peer-review "${paperTitle}" on PaperSub.AI.\n\nAccept: ${inviteUrl}\n\nExpires in 7 days.`,
  };
}

module.exports = { send, verificationEmail, passwordResetEmail, submissionStatusEmail, reviewReminderEmail, reviewAssignmentEmail, submissionConfirmedEmail, reviewerInvitationEmail, buildIcsAttachment };
