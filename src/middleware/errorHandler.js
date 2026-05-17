'use strict';

const logger = require('../utils/logger');

function notFound(req, res) {
  res.status(404).render('error', {
    title: 'Not Found',
    message: `The page "${req.originalUrl}" does not exist.`,
  });
}

function errorHandler(err, req, res, _next) {
  logger.error({ err, url: req.originalUrl }, 'Unhandled request error');
  const status = err.status || 500;
  res.status(status);
  if (req.accepts('html')) {
    res.render('error', {
      title: `Error ${status}`,
      message: status === 500 ? 'Something went wrong on our end.' : err.message,
    });
  } else {
    res.json({ error: err.message || 'Internal Server Error' });
  }
}

module.exports = { notFound, errorHandler };
