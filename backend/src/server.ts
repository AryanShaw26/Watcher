import { buildApp } from './app.js';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { logger } from './lib/logger.js';
import { startScheduler, stopScheduler } from './scheduler/scheduler.js';
import { startRetention, stopRetention } from './scheduler/retention.js';

const app = buildApp();
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'Watcher listening');
  startScheduler();
  startRetention();
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  await stopScheduler();
  stopRetention();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (error) => { logger.fatal(error); process.exit(1); });
process.on('uncaughtException', (error) => { logger.fatal(error); process.exit(1); });
