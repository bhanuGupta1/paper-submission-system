'use strict';

/**
 * LMS integration helpers — Canvas and Moodle webhook event normalisation.
 * Incoming webhooks are received at POST /api/lms/:provider/webhook.
 * Each event is mapped to a platform action (e.g. new submission, grade push).
 */

const crypto = require('crypto');
const logger = require('../utils/logger');

function verifyCanvasSignature(payload, signature, secret) {
  if (!secret) return true; // no secret configured — accept all (dev)
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature || ''));
}

function verifyMoodleToken(token, secret) {
  if (!secret) return true;
  return token === secret;
}

// Normalise a Canvas submission_created event into our internal format
function normaliseCanvas(body) {
  const { metadata, body: payload } = body;
  const eventType = metadata && metadata.event_name;
  if (!eventType) return null;

  if (eventType === 'submission_created' || eventType === 'submission_updated') {
    return {
      kind: 'lms_submission',
      provider: 'canvas',
      externalId: String(payload.id || ''),
      studentEmail: payload.user && payload.user.email,
      assignmentName: payload.assignment && payload.assignment.name,
      courseId: String((payload.course && payload.course.id) || ''),
      submittedAt: payload.submitted_at || new Date().toISOString(),
      raw: body,
    };
  }
  if (eventType === 'grade_change') {
    return {
      kind: 'lms_grade',
      provider: 'canvas',
      externalId: String(payload.submission && payload.submission.id || ''),
      grade: payload.grade,
      raw: body,
    };
  }
  return { kind: 'lms_unknown', provider: 'canvas', eventType, raw: body };
}

// Normalise a Moodle quiz_attempt_submitted or assign_submission_created
function normaliseMoodle(body) {
  const eventName = body.eventname || body.event;
  if (!eventName) return null;

  if (eventName.includes('submission')) {
    return {
      kind: 'lms_submission',
      provider: 'moodle',
      externalId: String(body.objectid || ''),
      studentEmail: body.relateduserid || body.userid,
      assignmentName: body.contextname || body.component,
      courseId: String(body.courseid || ''),
      submittedAt: body.timecreated ? new Date(body.timecreated * 1000).toISOString() : new Date().toISOString(),
      raw: body,
    };
  }
  return { kind: 'lms_unknown', provider: 'moodle', eventName, raw: body };
}

function normalise(provider, body) {
  if (provider === 'canvas') return normaliseCanvas(body);
  if (provider === 'moodle') return normaliseMoodle(body);
  return { kind: 'lms_unknown', provider, raw: body };
}

module.exports = { verifyCanvasSignature, verifyMoodleToken, normalise };
