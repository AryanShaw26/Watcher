import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import Redis from 'ioredis';
import { Kafka, logLevel } from 'kafkajs';

function testDatabaseUrl() {
  const source = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!source) throw new Error('DATABASE_URL is required for integration tests.');
  const url = new URL(source);
  url.pathname = '/watcher_test';
  return url.toString();
}

const databaseUrl = testDatabaseUrl();
const checks = await Promise.all([
  (async () => {
    const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });
    try {
      await client.connect();
      await client.query('SELECT 1');
      console.info('Postgres (watcher_test): reachable');
      return true;
    } catch (error) {
      console.error(`Postgres (watcher_test) unavailable: ${error.message}`);
      return false;
    } finally {
      await client.end().catch(() => {});
    }
  })(),
  (async () => {
    const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      lazyConnect: true,
      connectTimeout: 2000,
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false
    });
    let connectionError;
    redis.on('error', (error) => { connectionError = error; });
    try {
      await redis.connect();
      await redis.ping();
      console.info('Redis: reachable');
      return true;
    } catch (error) {
      console.error(`Redis unavailable: ${connectionError?.code || error.code || error.message}`);
      return false;
    } finally {
      redis.disconnect();
    }
  })(),
  (async () => {
    const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',').map((broker) => broker.trim());
    const kafka = new Kafka({
      clientId: 'watcher-integration-preflight',
      brokers,
      logLevel: logLevel.NOTHING,
      connectionTimeout: 2000,
      requestTimeout: 3000,
      retry: { retries: 0 }
    });
    const admin = kafka.admin();
    try {
      await admin.connect();
      await admin.listTopics();
      console.info('Kafka: reachable');
      return true;
    } catch (error) {
      console.error(`Kafka unavailable: ${error.message}`);
      return false;
    } finally {
      await admin.disconnect().catch(() => {});
    }
  })()
]);

if (checks.some((reachable) => !reachable)) {
  console.error('Integration tests were not started; required infrastructure is unavailable.');
  process.exit(1);
}

const child = spawnSync(
  process.execPath,
  ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.integration.config.ts'],
  {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrl, DIRECT_DATABASE_URL: databaseUrl }
  }
);
if (child.error) {
  console.error(`Could not start integration tests: ${child.error.message}`);
  process.exit(1);
}
process.exit(child.status ?? 1);
