'use strict';

const logger = require('../utils/logger');

function notFound(req, res) {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: `Route ${req.method} ${req.originalUrl} not found` });
  }
  res.status(404).render('errors/404', {
    title: '404 — Page not found',
    path: req.originalUrl,
  });
}

function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  logger.error({ err, status, url: req.originalUrl, method: req.method }, 'Request error');

  if (req.path.startsWith('/api/') || !req.accepts('html')) {
    return res.status(status).json({ error: status < 500 ? err.message : 'Internal Server Error' });
  }

  res.status(status);
  if (status === 403) return res.render('errors/403', { title: '403 — Forbidden', message: err.message || 'You do not have permission to access this page.' });
  if (status === 404) return res.render('errors/404', { title: '404 — Not found', path: req.originalUrl });
  res.render('errors/500', { title: '500 — Server error', message: process.env.NODE_ENV === 'development' ? (err.stack || err.message) : 'An unexpected error occurred. Please try again.' });
}

module.exports = { notFound, errorHandler };
