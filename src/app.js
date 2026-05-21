'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const helmet = require('helmet');
const passport = require('passport');
const config = require('./config');
const logger = require('./utils/logger');
const routes = require('./routes');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const N = require('./services/notifications');
const { setupPassport } = require('./services/oauth');

function createApp() {
  setupPassport();

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://cdn.tailwindcss.com', "'unsafe-inline'"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", 'https://cdn.tailwindcss.com', 'https://fonts.googleapis.com', "'unsafe-inline'"],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https://images.unsplash.com'],
      },
    },
  }));

  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use(session({
    name: config.session.name,
    store: new SQLiteStore({ db: 'sessions.db', dir: path.join(config.paths.root, 'data') }),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    proxy: Boolean(config.trustProxy),
    cookie: { httpOnly: true, secure: config.session.secureCookies, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 },
  }));

  // Make user info + unread-notifications count available to every view.
  const { GOOGLE_ENABLED, GITHUB_ENABLED } = require('./services/oauth');
  app.use(async (req, res, next) => {
    res.locals.googleOAuthEnabled = GOOGLE_ENABLED;
    res.locals.githubOAuthEnabled = GITHUB_ENABLED;
    if (req.session.userId) {
      res.locals.currentUser = { id: req.session.userId, role: req.session.role, username: req.session.username };
      try { res.locals.unreadCount = await N.unreadCount(req.session.userId); }
      catch (_e) { res.locals.unreadCount = 0; }
    } else {
      res.locals.currentUser = null;
      res.locals.unreadCount = 0;
    }
    next();
  });

  // Passport must be initialized after session middleware.
  app.use(passport.initialize());
  app.use(passport.session());
  // Passport session serialization — not used for primary auth but needed by OAuth callback.
  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id, done) => {
    try {
      const User = require('./models/User');
      const user = await User.findById(id);
      done(null, user || false);
    } catch (err) {
      done(err);
    }
  });

  app.use(routes);
  app.use(notFound);
  app.use(errorHandler);

  app.on('listening', () => logger.info('App listening'));
  return app;
}

module.exports = createApp;
