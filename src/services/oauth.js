'use strict';

const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const { Strategy: GitHubStrategy } = require('passport-github2');
const passport = require('passport');
const User = require('../models/User');
const { run, get } = require('../db/connection');
const config = require('../config');
const logger = require('../utils/logger');

const GOOGLE_ENABLED = Boolean(config.oauth && config.oauth.google.clientId && config.oauth.google.clientSecret);
const GITHUB_ENABLED = Boolean(config.oauth && config.oauth.github.clientId && config.oauth.github.clientSecret);

async function uniqueUsername(base) {
  let candidate = base;
  let i = 1;
  while (true) {
    const existing = await get('SELECT id FROM users WHERE username = ?', [candidate]);
    if (!existing) return candidate;
    candidate = `${base}${i++}`;
  }
}

async function findOrCreateOAuthUser({ provider, oauthId, email, displayName }) {
  // Check if OAuth user already exists
  let user = await get('SELECT * FROM users WHERE oauth_provider = ? AND oauth_id = ?', [provider, oauthId]);
  if (user) return user;

  // Try to link to existing email account
  if (email) {
    const existing = await User.findByEmail(email);
    if (existing) {
      await run('UPDATE users SET oauth_provider = ?, oauth_id = ? WHERE id = ?', [provider, oauthId, existing.id]);
      return User.findById(existing.id);
    }
  }

  // Create new account
  const safeName = (displayName || `user_${oauthId.slice(0, 8)}`).replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 30);
  const username = await uniqueUsername(safeName);
  const result = await run(
    `INSERT INTO users (username, email, password_hash, role, oauth_provider, oauth_id, email_verified)
     VALUES (?, ?, ?, 'author', ?, ?, 1)`,
    [username, email, '', provider, oauthId]
  );
  user = await User.findById(result.lastID);
  logger.info({ userId: user.id, provider }, 'New OAuth user created');
  return user;
}

function setupPassport() {
  if (GOOGLE_ENABLED) {
    passport.use(new GoogleStrategy(
      {
        clientID: config.oauth.google.clientId,
        clientSecret: config.oauth.google.clientSecret,
        callbackURL: `${config.appUrl}/auth/google/callback`,
        scope: ['profile', 'email'],
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = (profile.emails && profile.emails[0] && profile.emails[0].value) || null;
          const user = await findOrCreateOAuthUser({
            provider: 'google',
            oauthId: profile.id,
            email,
            displayName: profile.displayName,
          });
          return done(null, user);
        } catch (err) {
          logger.error({ err }, 'Google OAuth strategy error');
          return done(err);
        }
      }
    ));
    logger.info('Google OAuth strategy registered');
  } else {
    logger.info('Google OAuth not configured (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET not set)');
  }

  if (GITHUB_ENABLED) {
    passport.use(new GitHubStrategy(
      {
        clientID: config.oauth.github.clientId,
        clientSecret: config.oauth.github.clientSecret,
        callbackURL: `${config.appUrl}/auth/github/callback`,
        scope: ['user:email'],
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const emails = profile.emails || [];
          const email = (emails.find((e) => e.primary) || emails[0] || {}).value || null;
          const user = await findOrCreateOAuthUser({
            provider: 'github',
            oauthId: String(profile.id),
            email,
            displayName: profile.displayName || profile.username,
          });
          return done(null, user);
        } catch (err) {
          logger.error({ err }, 'GitHub OAuth strategy error');
          return done(err);
        }
      }
    ));
    logger.info('GitHub OAuth strategy registered');
  } else {
    logger.info('GitHub OAuth not configured (GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET not set)');
  }
}

module.exports = { setupPassport, GOOGLE_ENABLED, GITHUB_ENABLED };
