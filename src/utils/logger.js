'use strict';

const pino = require('pino');
const config = require('../config');

const logger = pino({
  level: config.logging.level,
  transport:
    config.env === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
      : undefined,
});

module.exports = logger;
