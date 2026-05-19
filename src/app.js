'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const helmet = require('helmet');
const config = require('./config');
const logger = require('./utils/logger');
const routes = require('./routes');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const N = require('./services/notifications');

function createApp() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://cdn.tailwindcss.com', "'unsafe-inline'"],
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
  app.use(async (req, res, next) => {
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

  app.use(routes);
  app.use(notFound);
  app.use(errorHandler);

  app.on('listening', () => logger.info('App listening'));
  return app;
}

module.exports = createApp;
