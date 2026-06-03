'use strict';

const createApp = require('./app');
const migrate = require('./db/migrate');
const config = require('./config');
const logger = require('./utils/logger');
const deadlineReminder = require('./services/deadlineReminder');
const jwtService = require('./services/jwt');
const cron = require('node-cron');
const backup = require('./db/backup');
const digest = require('./services/digestEmail');

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

  // Weekly editorial digest every Monday at 08:00
  cron.schedule('0 8 * * 1', () => {
    digest.sendDigests().catch((err) => logger.error({ err }, 'Weekly digest failed'));
  });
  logger.info('Weekly digest cron scheduled (Mon 08:00)');
}

start().catch((err) => { logger.error({ err }, 'Startup failed'); process.exit(1); });

// Log AI provider status on startup (never log the key value)
const llmStatus = (() => {
  const p = config.llm.provider;
  if (p === 'groq') return config.llm.groq.apiKey ? 'Groq: configured' : 'Groq: GROQ_API_KEY missing — heuristic fallback active';
  if (p === 'openrouter') return config.llm.openrouter.apiKey ? 'OpenRouter: configured' : 'OpenRouter: OPENROUTER_API_KEY missing — heuristic fallback active';
  return 'heuristic (offline, zero-cost)';
})();
logger.info({ llmProvider: config.llm.provider }, `AI provider: ${llmStatus}`);

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
