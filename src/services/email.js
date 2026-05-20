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

async function send({ to, subject, html, text }) {
  const transport = getTransport();
  if (!transport) {
    logger.info({ to, subject }, '[email] Email disabled — would have sent');
    return { simulated: true };
  }
  try {
    const info = await transport.sendMail({ from: config.email.from, to, subject, html, text });
    logger.info({ to, subject, messageId: info.messageId }, '[email] Sent');
    return info;
  } catch (err) {
    logger.error({ err, to, subject }, '[email] Send failed');
    throw err;
  }
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

module.exports = { send, verificationEmail, passwordResetEmail, submissionStatusEmail, reviewReminderEmail };
