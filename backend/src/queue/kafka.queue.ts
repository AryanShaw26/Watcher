import {
  Kafka,
  logLevel,
  type Admin,
  type Consumer,
  type ITopicConfig,
  type Producer,
} from 'kafkajs';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import type { CheckResultEvent } from './event.js';
import type { QueueMessage, ResultQueue } from './types.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  fallback: () => T,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve, reject) => {
        timer = setTimeout(() => {
          try {
            resolve(fallback());
          } catch (error) {
            reject(error);
          }
        }, milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class KafkaQueue implements ResultQueue {
  private readonly kafka: Kafka;
  private producer: Producer;
  private admin: Admin;
  private consumer?: Consumer;
  private closed = false;
  private connecting?: Promise<void>;
  private statsCache: {
    at: number;
    value: { connected: boolean; lag: number | null; dlqDepth: number | null };
  } | null = null;

  constructor() {
    const credentials = { username: env.KAFKA_USERNAME, password: env.KAFKA_PASSWORD };
    const sasl =
      env.KAFKA_SASL_MECHANISM === 'plain'
        ? { mechanism: 'plain' as const, ...credentials }
        : env.KAFKA_SASL_MECHANISM === 'scram-sha-256'
          ? { mechanism: 'scram-sha-256' as const, ...credentials }
          : env.KAFKA_SASL_MECHANISM === 'scram-sha-512'
            ? { mechanism: 'scram-sha-512' as const, ...credentials }
            : undefined;
    this.kafka = new Kafka({
      clientId: env.KAFKA_CLIENT_ID,
      brokers: env.KAFKA_BROKERS.split(',')
        .map((broker) => broker.trim())
        .filter(Boolean),
      ssl: env.KAFKA_SSL,
      ...(sasl ? { sasl } : {}),
      connectionTimeout: 10000,
      retry: { retries: 5, initialRetryTime: 300 },
      logLevel: logLevel.WARN,
      logCreator: () => (entry) => {
        const { namespace, level, label, log } = entry;
        if (level === logLevel.ERROR) logger.error({ namespace, label, ...log }, 'Kafka');
        else if (level === logLevel.WARN) logger.warn({ namespace, label, ...log }, 'Kafka');
        else logger.info({ namespace, label, ...log }, 'Kafka');
      },
    });
    this.producer = this.kafka.producer({
      idempotent: true,
      maxInFlightRequests: 1,
      allowAutoTopicCreation: false,
    });
    this.admin = this.kafka.admin();
  }

  private async connect(): Promise<void> {
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      await this.admin.connect();
      if (env.KAFKA_AUTO_CREATE_TOPICS) {
        const configs: ITopicConfig[] = [
          {
            topic: env.KAFKA_TOPIC_RESULTS,
            numPartitions: env.KAFKA_TOPIC_PARTITIONS,
            replicationFactor: 1,
          },
          { topic: env.KAFKA_TOPIC_DLQ, numPartitions: 1, replicationFactor: 1 },
        ];
        await this.admin.createTopics({ topics: configs, waitForLeaders: true });
      } else {
        const topics = await this.admin.listTopics();
        const missing = [env.KAFKA_TOPIC_RESULTS, env.KAFKA_TOPIC_DLQ].filter(
          (topic) => !topics.includes(topic),
        );
        if (missing.length) throw new Error(`Kafka topics are missing: ${missing.join(', ')}`);
      }
      await this.producer.connect();
      logger.info('Kafka topics ready');
    })().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  async publish(event: CheckResultEvent): Promise<void> {
    await withTimeout(
      this.connect().then(() =>
        this.producer.send({
          topic: env.KAFKA_TOPIC_RESULTS,
          acks: -1,
          timeout: env.PUBLISH_TIMEOUT_MS,
          messages: [
            { key: event.monitorId, value: JSON.stringify(event), headers: { schemaVersion: '1' } },
          ],
        }),
      ),
      env.PUBLISH_TIMEOUT_MS,
      () => {
        throw new Error('Kafka publish timed out');
      },
    );
    this.statsCache = null;
  }

  async consume(handler: (msg: QueueMessage) => Promise<void>): Promise<void> {
    this.closed = false;
    while (!this.closed) {
      try {
        this.consumer = this.kafka.consumer({
          groupId: env.KAFKA_CONSUMER_GROUP,
          sessionTimeout: 30000,
          heartbeatInterval: 3000,
        });
        await this.connect();
        await this.consumer.connect();
        await this.consumer.subscribe({ topic: env.KAFKA_TOPIC_RESULTS, fromBeginning: true });
        logger.info('Kafka consumer started');
        await this.consumer.run({
          eachMessage: async ({ topic, partition, message }) => {
            await handler({
              key: message.key?.toString() ?? 'unknown',
              value: message.value?.toString() ?? '',
              meta: { topic, partition, offset: message.offset },
            });
          },
        });
        break;
      } catch (error) {
        if (this.closed) break;
        logger.error({ error }, 'Kafka consumer stopped; reconnecting');
        await this.consumer?.disconnect().catch(() => undefined);
        await sleep(1000);
      }
    }
  }

  async publishToDlq(
    msg: QueueMessage,
    reason: { error: string; attempts: number },
  ): Promise<void> {
    await this.connect();
    await this.producer.send({
      topic: env.KAFKA_TOPIC_DLQ,
      acks: -1,
      timeout: env.PUBLISH_TIMEOUT_MS,
      messages: [
        {
          key: msg.key === 'unknown' ? null : msg.key,
          value: msg.value,
          headers: {
            'x-error': reason.error.slice(0, 500),
            'x-attempts': String(reason.attempts),
            'x-source-topic': msg.meta.topic,
            'x-source-partition': String(msg.meta.partition ?? ''),
            'x-source-offset': msg.meta.offset ?? '',
            'x-failed-at': new Date().toISOString(),
          },
        },
      ],
    });
  }

  async getStats(): Promise<{ connected: boolean; lag: number | null; dlqDepth: number | null }> {
    if (this.statsCache && Date.now() - this.statsCache.at < 5000) return this.statsCache.value;
    try {
      const value = await withTimeout(this.readStats(), 2000, () => ({
        connected: false,
        lag: null,
        dlqDepth: null,
      }));
      this.statsCache = { at: Date.now(), value };
      return value;
    } catch {
      return { connected: false, lag: null, dlqDepth: null };
    }
  }

  private async readStats(): Promise<{
    connected: boolean;
    lag: number | null;
    dlqDepth: number | null;
  }> {
    await this.connect();
    const metadata = await this.admin.fetchTopicMetadata({
      topics: [env.KAFKA_TOPIC_RESULTS, env.KAFKA_TOPIC_DLQ],
    });
    const found = new Set(metadata.topics.map((topic) => topic.name));
    if (!found.has(env.KAFKA_TOPIC_RESULTS) || !found.has(env.KAFKA_TOPIC_DLQ))
      return { connected: false, lag: null, dlqDepth: null };
    const resultOffsets = await this.admin.fetchTopicOffsets(env.KAFKA_TOPIC_RESULTS);
    const committed = await this.admin.fetchOffsets({
      groupId: env.KAFKA_CONSUMER_GROUP,
      topics: [env.KAFKA_TOPIC_RESULTS],
    });
    const groupPartitions = committed.flatMap((item) => item.partitions);
    const lag = resultOffsets.reduce((sum, partition) => {
      const group = groupPartitions.find((item) => item.partition === partition.partition);
      const offset = Number(group?.offset ?? partition.low);
      return sum + Math.max(0, Number(partition.high) - Math.max(offset, Number(partition.low)));
    }, 0);
    const dlq = await this.admin.fetchTopicOffsets(env.KAFKA_TOPIC_DLQ);
    const dlqDepth = dlq.reduce(
      (sum, partition) => sum + Number(partition.high) - Number(partition.low),
      0,
    );
    return { connected: true, lag, dlqDepth };
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([
      this.consumer?.disconnect(),
      this.producer.disconnect(),
      this.admin.disconnect(),
    ]);
  }
}
