'use strict';

const createApp = require('./app');
const migrate = require('./db/migrate');
const config = require('./config');
const logger = require('./utils/logger');
const deadlineReminder = require('./services/deadlineReminder');
const jwtService = require('./services/jwt');
const cron = require('node-cron');
const backup = require('./db/backup');

const app = createApp();

async function start() {
  await migrate();
  deadlineReminder.start();
  // Prune expired refresh tokens daily
  setInterval(() => jwtService.pruneExpired().catch(() => {}), 24 * 60 * 60 * 1000);
  // Daily SQLite backup at 02:00 server time
  cron.schedule('0 2 * * *', () => {
    backup.run().catch((err) => logger.error({ err }, 'Scheduled backup failed'));
  });
  logger.info('Daily backup cron scheduled (02:00)');
}

start().catch((err) => { logger.error({ err }, 'Startup failed'); process.exit(1); });

const server = app.listen(config.port, () => {
  logger.info(`Server listening on http://localhost:${config.port}`);
});

const shutdown = (signal) => {
  logger.info({ signal }, 'Shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
