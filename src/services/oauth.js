'use strict';

const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const passport = require('passport');
const User = require('../models/User');
const { run, get } = require('../db/connection');
const config = require('../config');
const logger = require('../utils/logger');

const GOOGLE_ENABLED = Boolean(config.oauth && config.oauth.google.clientId && config.oauth.google.clientSecret);

function setupPassport() {
  if (!GOOGLE_ENABLED) {
    logger.info('Google OAuth not configured (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET not set)');
    return;
  }

  passport.use(new GoogleStrategy(
    {
      clientID: config.oauth.google.clientId,
      clientSecret: config.oauth.google.clientSecret,
      callbackURL: `${config.appUrl}/auth/google/callback`,
      scope: ['profile', 'email'],
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const googleId = profile.id;
        const email = (profile.emails && profile.emails[0] && profile.emails[0].value) || null;
        const displayName = profile.displayName || profile.username || `user_${googleId.slice(0, 8)}`;

        // Check if OAuth user already exists
        let user = await get('SELECT * FROM users WHERE oauth_provider = ? AND oauth_id = ?', ['google', googleId]);
        if (user) return done(null, user);

        // Try to link to existing email account
        if (email) {
          const existing = await User.findByEmail(email);
          if (existing) {
            await run('UPDATE users SET oauth_provider = ?, oauth_id = ? WHERE id = ?', ['google', googleId, existing.id]);
            return done(null, existing);
          }
        }

        // Create new account — default role is author, let them choose on first login
        const safeName = displayName.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 30);
        const username = await uniqueUsername(safeName);
        const result = await run(
          `INSERT INTO users (username, email, password_hash, role, oauth_provider, oauth_id, email_verified)
           VALUES (?, ?, ?, 'author', 'google', ?, 1)`,
          [username, email, '', googleId]
        );
        user = await User.findById(result.lastID);
        logger.info({ userId: user.id, provider: 'google' }, 'New OAuth user created');
        return done(null, user);
      } catch (err) {
        logger.error({ err }, 'Google OAuth strategy error');
        return done(err);
      }
    }
  ));

  logger.info('Google OAuth strategy registered');
}

async function uniqueUsername(base) {
  let candidate = base;
  let i = 1;
  while (true) {
    const existing = await get('SELECT id FROM users WHERE username = ?', [candidate]);
    if (!existing) return candidate;
    candidate = `${base}${i++}`;
  }
}

module.exports = { setupPassport, GOOGLE_ENABLED };
