# Watcher: Product Requirements Document (Version 2)

> **Your APIs. Always in Sight.**

| | |
|---|---|
| **Product** | Watcher, an API uptime and latency monitor |
| **Version** | 2.0 ("Event-driven pipeline") |
| **Builds on** | Version 1 (`PRD.md`, tagged `v1`) |
| **Styling** | `design.md` (unchanged) |
| **Companion doc** | `implementation-v2.md` |

> **Agent instructions:** This document describes **only what changes from Version 1**. Everything in `PRD.md` still applies unless this document says otherwise (auth, monitors CRUD, SSRF protection, error format, design). Use the names, keys, topics, and env vars in this file verbatim. Do not add Version 3 features (alerting, incidents, p50/p95 analytics, retention changes). If something is ambiguous, choose the simplest option that satisfies the acceptance criteria and note it in the README.

---

## 1. Overview

Version 1 checks monitors and writes the result straight to Postgres from one process. Version 2 replaces that with an **event-driven pipeline**:

```
Scheduler → (Redis lock) → Checker → queue: check.results → Consumer → Postgres + Redis status cache
```

The user-visible product barely changes. What changes is the architecture, which is what makes the project stand out: Kafka decouples checking from storage, Redis provides locking, caching, and shared rate limiting, and the system keeps working when parts of it fail.

### 1.1 Goals
1. Checks publish **events** to a message queue (Kafka by default) instead of writing to the database directly.
2. A separate **consumer** stores each event in Postgres exactly once (idempotent) and updates a Redis status cache.
3. A Redis **lock** prevents the same monitor from being checked twice at the same time.
4. Rate limiting uses Redis, so limits are shared across instances and survive restarts.
5. Failures are handled deliberately: retries, a dead-letter topic, and safe fallbacks (section 7 and section 8).
6. The queue sits behind an interface with **Kafka**, **Redis Streams**, and **in-memory** implementations, selected by an env var.
7. The whole stack runs locally with one command (`docker compose up --build`).
8. The dashboard shows a small **Pipeline** card (healthy, catching up, degraded) so the architecture is visible in the demo.

### 1.2 Non-Goals (still out of scope)
- Alerting, incidents, p50 and p95 percentiles, uptime over 7 days beyond V1's stats (V3)
- Schema registry, Avro or Protobuf (JSON events only)
- Multi-broker Kafka, transactions or exactly-once semantics (we use at-least-once delivery plus idempotent writes)
- Kubernetes, autoscaling, or metrics stacks (Prometheus, Grafana)
- Frontend changes other than the Pipeline card

### 1.3 What changes from V1 at a glance

| Area | V1 | V2 |
|---|---|---|
| Result path | Scheduler → `recordResult()` → Postgres | Scheduler → queue → consumer → `recordResult()` → Postgres + Redis |
| Processes | One process does everything | Same codebase, three **roles**: `api`, `scheduler`, `consumer` |
| Duplicate protection | `SKIP LOCKED` claim only | `SKIP LOCKED` claim + Redis per-monitor lock + idempotent `event_id` |
| Rate limiting | In-memory | Redis-backed |
| Status reads | Postgres columns | Redis cache, with fallback to Postgres columns |
| Local stack | Postgres only | Postgres, Redis, Kafka (KRaft), api, scheduler, consumer, web |
| Failure handling | Log and move on | Retry, DLQ, fallbacks |

---

## 2. Tech Stack Additions

| Concern | Choice |
|---|---|
| Kafka client | `kafkajs` (pure JS, works on Windows, Alpine, and Render without native builds) |
| Redis client | `ioredis` |
| Redis-backed rate limiting | `rate-limit-redis` (with the existing `express-rate-limit`) |
| Local Kafka | `apache/kafka:3.9.1` in **KRaft** mode (no ZooKeeper), single node |
| Local Redis | `redis:7-alpine` |
| Cross-platform env in npm scripts | `cross-env` (dev dependency; the team develops on Windows) |
| Frontend container | `nginx:alpine` serving the built SPA and proxying `/api` |

> **Kafka version note:** `kafkajs` has not had a release in a long time and uses older Kafka protocol versions. That is fine against Kafka 3.9.x and against the managed services, so **pin the local broker to a 3.9.x image** and do not use a 4.x image locally. If `apache/kafka:3.9.1` is not available, use the newest 3.9.x tag. If the project later needs Kafka 4.x, swap the client for `@confluentinc/kafka-javascript` behind the same queue interface.

---

## 3. System Architecture

### 3.1 Diagram

```mermaid
flowchart LR
    U[Browser] --> W[Web: React SPA]
    W -->|/api| API

    subgraph Roles[Same codebase, three roles]
        API[api role: Express]
        SCH[scheduler role: claim + check + publish]
        CON[consumer role: validate + store]
    end

    SCH -->|claim due monitors| PG[(Postgres / Neon)]
    SCH -->|SET NX lock| R[(Redis)]
    SCH -->|publish event| K[[Kafka: check.results]]
    K -->|consumer group| CON
    CON -->|"INSERT ... ON CONFLICT (event_id)"| PG
    CON -->|status cache + last processed| R
    CON -.->|after retries| D[[Kafka: check.results.dlq]]
    API -->|monitor config| PG
    API -->|status overlay, rate limits| R
    API -->|lag, DLQ depth| K
```

### 3.2 Roles
One image, one entrypoint (`src/server.ts`). The `ROLES` env var (comma-separated) decides what a process does.

| Role | Does | Needs |
|---|---|---|
| `api` | HTTP server: auth, monitors, results, stats, health, pipeline status | Postgres, Redis, queue (for stats only) |
| `scheduler` | Tick loop: claim due monitors, lock, run check, publish event. Also runs the hourly retention job | Postgres, Redis, queue |
| `consumer` | Reads events, retries, DLQ, writes Postgres, updates Redis | Postgres, Redis, queue |

- Locally (Docker Compose) each role is its own container, so you can stop one and watch the others.
- On Render's free tier only **one** web service is free, so production runs `ROLES=api,scheduler,consumer` in a single process. The code is identical.
- `SCHEDULER_ENABLED` from V1 is replaced by the `scheduler` role being present in `ROLES`.
- Graceful shutdown stops each active role in reverse order of startup (stop accepting work, finish in-flight work with a 10 second cap, close connections).

### 3.3 End-to-end flow of one check

1. **Claim:** the scheduler runs V1's atomic `UPDATE ... FOR UPDATE SKIP LOCKED ... RETURNING *`. This decides **when** a monitor is due and advances `next_check_at`.
2. **Lock:** for each claimed monitor, `SET lock:check:{id} {token} NX PX {ttl}`. If the lock is already held, skip (another instance is still checking it).
3. **Check:** `runCheck(monitor)` (unchanged from V1, pure function, SSRF-safe).
4. **Publish:** build a `CheckResultEvent` (section 4) with a new `eventId` and publish it to the queue. If publishing fails, fall back to writing directly (section 8.2).
5. **Unlock:** release the lock (compare-and-delete).
6. **Consume:** the consumer receives the event, validates it, and calls `recordResult(event)` inside retry logic.
7. **Store:** in one transaction, insert the result (ignore duplicates by `event_id`) and update the monitor's latest state (ignore out-of-order events).
8. **Cache:** if the monitor state was applied, write the Redis status hash and `last_processed`.
9. **Read:** the API merges Redis status over the monitor rows for the dashboard, falling back to the Postgres columns on a cache miss or Redis outage.

### 3.4 Why both an SQL claim and a Redis lock
They guard different things. Say this in the README:
- The **SQL claim** (V1) decides *which* monitors are due and makes sure two schedulers do not claim the same due row.
- The **Redis lock** prevents *overlapping execution* of the same monitor, for example when a check is slow, an instance crashed mid-check, or a monitor was claimed twice through a manual action. It uses a TTL so a crashed instance cannot hold a lock forever.

### 3.5 Design decision: Redis is a cache, not the source of truth
Postgres stays the source of truth. Redis holds disposable data: locks, status cache, rate-limit counters, and the last-processed timestamp. If Redis restarts or loses data (as the free managed tiers can), the app keeps working through the fallbacks in section 5.5. State this honestly in the README: at this scale Postgres alone could serve the dashboard, and the cache exists to keep dashboard polling off the primary read path and to build on in V3 (alert state and cooldowns).

### 3.6 Forward-compatibility with V3
- Event schema carries `schemaVersion` so it can evolve.
- The consumer group id is configurable (`KAFKA_CONSUMER_GROUP`). V3 will add a **second consumer group** (alerts) reading the same topic, which is the main reason Kafka fits better than a plain queue.
- `recordResult` returns `{ inserted, applied, previousStatus }` so V3 can detect a status change (up to down) without extra queries.

---

## 4. Event Contract

### 4.1 Topics

| Topic | Partitions (local and managed) | Key | Purpose |
|---|---|---|---|
| `check.results` | 3 | `monitorId` | One event per completed check |
| `check.results.dlq` | 1 | `monitorId` (or `unknown`) | Events that could not be processed |

Keying by `monitorId` guarantees that all events for one monitor land on the same partition, so they are consumed in order.

### 4.2 `CheckResultEvent` (JSON value)

```json
{
  "schemaVersion": 1,
  "eventId": "6f1c2c1e-6f1d-4e0a-9d0b-2f2c5a0e9a11",
  "monitorId": "uuid",
  "checkedAt": "2026-01-01T10:00:00.000Z",
  "status": "up",
  "statusCode": 200,
  "responseTimeMs": 142,
  "error": null,
  "source": "scheduler"
}
```

| Field | Type | Rules |
|---|---|---|
| `schemaVersion` | integer | Must be `1`. Unknown versions go to the DLQ. |
| `eventId` | uuid v4 | Generated at publish time. The idempotency key. |
| `monitorId` | uuid | Must reference a monitor (if the monitor was deleted, the event is dropped, see 7.5). |
| `checkedAt` | ISO-8601 UTC string | Time the check finished |
| `status` | `"up"` or `"down"` | |
| `statusCode` | integer or null | 100 to 599 |
| `responseTimeMs` | integer or null | 0 or more |
| `error` | string or null | Max 500 characters, sanitized (no stack traces) |
| `source` | `"scheduler"` or `"manual"` | Informational |

Validate with a zod schema in `src/queue/event.ts` (`.strict()`). Export the type and a `buildEvent(monitor, outcome, source)` helper.

### 4.3 Delivery guarantees (document these in the README)
- **At-least-once delivery** from the queue.
- **Effectively-once storage:** `check_results.event_id` is unique, so a redelivered event is ignored.
- **Per-monitor ordering** within a partition. An older event that arrives late still gets stored in the history, but does not overwrite the monitor's newer latest state.

---

## 5. Redis

### 5.1 Connection
`ioredis` using `REDIS_URL` (`redis://` locally, `rediss://` for TLS in production). Options: `maxRetriesPerRequest: 2`, `enableOfflineQueue: false` for request-path calls, a reconnect strategy with backoff up to 5 seconds, and a connection timeout of 5 seconds. Never log the URL. Expose `redisIsUp()` for health reporting. One shared client per process, plus a separate dedicated client for blocking calls (Redis Streams driver).

### 5.2 Key space
All keys start with `REDIS_KEY_PREFIX` (default `watcher:`).

| Key | Type | TTL | Written by | Purpose |
|---|---|---|---|---|
| `lock:check:{monitorId}` | string (token) | `timeoutMs + LOCK_TTL_BUFFER_SECONDS` | scheduler | Per-monitor check lock |
| `status:{monitorId}` | hash | `STATUS_CACHE_TTL_SECONDS` | consumer, manual check | Latest status for the dashboard |
| `pipeline:last_processed` | string (ISO time) | none | consumer | Last time an event was stored |
| `rl:*` | managed by `rate-limit-redis` | window | api | Rate-limit counters |
| `stream:check.results`, `stream:check.results.dlq` | stream | trimmed by `REDIS_STREAM_MAXLEN` | Redis Streams driver only | Queue transport |

`status:{monitorId}` hash fields: `status`, `statusCode`, `responseTimeMs`, `lastCheckedAt`, `lastError`, `consecutiveFailures`. Store missing values as an empty string and convert back to `null` on read.

### 5.3 Lock (`src/redis/lock.ts`)
```ts
acquireLock(key: string, ttlMs: number): Promise<{ token: string } | null>
releaseLock(key: string, token: string): Promise<void>
```
- Acquire: `SET key token NX PX ttlMs`, with `token = crypto.randomUUID()`.
- Release: a Lua script (compare and delete) so one instance never releases another's lock:
  ```lua
  if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end
  ```
- **If Redis is unreachable, acquire succeeds without a lock (fail open)** and logs a warning. Availability of checks matters more than strict overlap protection.

### 5.4 Status cache (`src/redis/statusCache.ts`)
```ts
setStatus(monitorId, status): Promise<void>        // HSET + EXPIRE, swallow and log errors
getStatuses(monitorIds): Promise<Map<string, Status>>  // one pipeline of HGETALL calls
deleteStatus(monitorId): Promise<void>
```
All three swallow Redis errors (log at warn) and never throw into the request path.

### 5.5 Failure behavior (Redis down)

| Component | Behavior |
|---|---|
| API status reads | Use the Postgres columns (cache miss path). Responses are identical in shape. |
| Scheduler lock | Fail open (section 5.3) |
| Consumer cache write | Skipped and logged. The Postgres write still succeeds. |
| Rate limiting | Fail open (`passOnStoreError: true`) and log. Accepted trade-off, listed in the risks. |
| Pipeline card | Shows **degraded** with reason `redis` |

Recovery must be automatic once Redis is back, without restarting anything.

### 5.6 Rate limiting
Replace V1's in-memory stores with `rate-limit-redis` (`RedisStore`, using the shared ioredis client via `sendCommand`) for all four limiters from V1. Limits and error responses are unchanged. When `RATE_LIMIT_STORE=memory`, keep the V1 in-memory behavior (used in tests).

---

## 6. Queue Abstraction

### 6.1 Interface (`src/queue/types.ts`)

```ts
export type QueueMessage = {
  key: string;                 // monitorId, or "unknown"
  value: string;               // raw JSON string
  meta: { topic: string; partition?: number; offset?: string; id?: string };
};

export interface ResultQueue {
  /** Publish an event. Throws if it could not be accepted within PUBLISH_TIMEOUT_MS. */
  publish(event: CheckResultEvent): Promise<void>;
  /** Start consuming. The handler resolving means "acknowledge". Throwing means "do not acknowledge". */
  consume(handler: (msg: QueueMessage) => Promise<void>): Promise<void>;
  /** Put a message on the dead-letter destination with a reason. */
  publishToDlq(msg: QueueMessage, reason: { error: string; attempts: number }): Promise<void>;
  /** Health and depth, used by /api/system/pipeline. Must not throw. */
  getStats(): Promise<{ connected: boolean; lag: number | null; dlqDepth: number | null }>;
  close(): Promise<void>;
}
```
`src/queue/index.ts` exports `createQueue(env)`, which returns the implementation chosen by `QUEUE_DRIVER`.

The queue drivers handle **transport only**. Retry and dead-letter logic lives once, in `src/consumer/handleMessage.ts`, so every driver behaves the same.

### 6.2 Drivers

| `QUEUE_DRIVER` | Use | Notes |
|---|---|---|
| `kafka` | Default locally and the headline production option | Section 6.3 |
| `redis-streams` | Production fallback if no managed Kafka is available, and a second implementation to show the abstraction is real | Section 6.4 |
| `memory` | Unit tests only. Never allowed when `NODE_ENV=production` (fail at boot). | In-process array, `drain()` helper for tests |

### 6.3 Kafka driver (`kafka.queue.ts`)
- Client: `clientId` from `KAFKA_CLIENT_ID`, brokers from `KAFKA_BROKERS` (comma-separated), `ssl` from `KAFKA_SSL`, `sasl` from `KAFKA_SASL_MECHANISM` (`plain`, `scram-sha-256`, `scram-sha-512`, or empty for none) with `KAFKA_USERNAME` and `KAFKA_PASSWORD`. Connection timeout 10 seconds, `retry: { retries: 5, initialRetryTime: 300 }`. Route kafkajs logs into pino (levels warn and above).
- **Topic setup:** if `KAFKA_AUTO_CREATE_TOPICS=true`, create both topics at boot with the admin client when they do not exist (partitions from `KAFKA_TOPIC_PARTITIONS` for `check.results`, 1 for the DLQ, replication factor 1 locally). If `false` (managed Kafka), only verify they exist and fail with a clear error message if not.
- **Producer:** `idempotent: true`, `maxInFlightRequests: 1`, `allowAutoTopicCreation: false`. Send with `acks: -1`, `timeout: PUBLISH_TIMEOUT_MS`, key `monitorId`, value JSON, header `schemaVersion`.
- **Consumer:** `groupId: KAFKA_CONSUMER_GROUP`, `fromBeginning: true` (applies only when the group has no committed offset), `sessionTimeout: 30000`, `heartbeatInterval: 3000`, `eachMessage` handler. Offsets are committed automatically after the handler resolves. If the handler throws, kafkajs retries the message and eventually restarts the consumer, so the handler only throws when the DLQ publish itself fails.
- **DLQ:** produce the original raw value and key to `check.results.dlq` with headers `x-error`, `x-attempts`, `x-source-topic`, `x-source-partition`, `x-source-offset`, `x-failed-at`.
- **getStats:** `connected` from a cached admin metadata call. `lag` is the sum over partitions of `(high watermark minus committed offset)` using `admin.fetchTopicOffsets` and `admin.fetchOffsets({ groupId, topics })` (treat a committed offset of `-1` as the low watermark). `dlqDepth` is high minus low watermark of the DLQ topic. Cache results in memory for 5 seconds. On any error return `{ connected: false, lag: null, dlqDepth: null }`.

### 6.4 Redis Streams driver (`redisStreams.queue.ts`)
- Streams: `{prefix}stream:check.results` and `{prefix}stream:check.results.dlq`.
- Publish: `XADD stream MAXLEN ~ REDIS_STREAM_MAXLEN * key {monitorId} value {json}`.
- Consume: create the group with `XGROUP CREATE ... 0 MKSTREAM` (ignore "already exists"), then loop `XREADGROUP GROUP {KAFKA_CONSUMER_GROUP} {consumerName} COUNT 10 BLOCK 5000 STREAMS stream >`, call the handler per entry, and `XACK` on success. `consumerName` is `hostname-pid`. Use the dedicated blocking connection.
- Recovery: at start and every 30 seconds run `XAUTOCLAIM` for entries idle more than 60 seconds so messages from a crashed consumer are processed by another.
- DLQ: `XADD` to the DLQ stream with fields `value`, `key`, `error`, `attempts`, `sourceId`, `failedAt`.
- getStats: `lag` from `XINFO GROUPS` (the `lag` field; fall back to `XLEN` minus entries read if missing), `dlqDepth` from `XLEN` of the DLQ stream.
- The group name reuses `KAFKA_CONSUMER_GROUP` so there is one name to configure.

### 6.5 Contract tests
One shared test suite (`tests/queue.contract.ts`) runs against **memory**, **redis-streams**, and **kafka**. It checks: publish then consume receives the event, the handler throwing leaves the message unacknowledged and it is redelivered, `publishToDlq` is visible in `getStats().dlqDepth`, and `close()` stops consuming. Kafka and Redis variants run only in the integration test command (section 15).

---

## 7. Consumer

### 7.1 Handler (`src/consumer/handleMessage.ts`)
For each `QueueMessage`:

1. **Parse and validate** the JSON against the event schema.
   - Invalid JSON, schema failure, or unsupported `schemaVersion` is a **poison message**: send to the DLQ immediately with `attempts: 0` and the validation error. Do not retry. Acknowledge.
2. **Process with retries:** call `recordResult(event)`, then update the cache. On a thrown error, retry up to `CONSUMER_MAX_ATTEMPTS` (default 3) total attempts, waiting `CONSUMER_RETRY_BASE_MS * 4^(attempt-1)` between attempts (200 ms, 800 ms, 3200 ms by default). While waiting, keep the queue session alive (call the driver's heartbeat if one exists).
3. **After the last failed attempt:** `publishToDlq(msg, { error, attempts })`, log at error level, acknowledge.
4. **If the DLQ publish itself fails:** throw, so the message is not acknowledged and will be redelivered. This is the only case where the handler throws.

### 7.2 What counts as retryable
Any database error that is not listed in section 7.5, plus transient network errors. Do not retry validation errors.

### 7.3 After a successful store
If `applied` is true, `setStatus(...)` in Redis. Always `SET pipeline:last_processed` with the current time (errors swallowed). Log one line: `eventId, monitorId, status, partition, offset, inserted, applied`.

### 7.4 Ordering and idempotency
Handled in `recordResult` (section 9). The consumer holds no state between messages.

### 7.5 Expected non-errors (acknowledge, do not retry, do not DLQ)
- **Duplicate event** (`inserted: false`): log at debug and move on.
- **Monitor deleted** (foreign key violation, Postgres code `23503`): the check result has nowhere to go. Log at debug and acknowledge.
- **Out-of-order event** (`inserted: true`, `applied: false`): stored in the history, not applied to the latest state.

### 7.6 Shutdown
On `SIGTERM` or `SIGINT`, stop fetching, let the in-flight message finish (10 second cap), disconnect from the queue, then close Redis and the Postgres pool.

---

## 8. Scheduler and Producer Changes

### 8.1 Tick (`src/scheduler/scheduler.ts`)
Same non-overlapping loop and `claimDueMonitors` as V1. For each claimed monitor, under `p-limit(CHECK_CONCURRENCY)`:

```
lock = acquireLock(`lock:check:${id}`, monitor.timeoutMs + LOCK_TTL_BUFFER_SECONDS * 1000)
if (!lock) { log.debug skipped; return }
try {
  outcome = await runCheck(monitor)
  event = buildEvent(monitor, outcome, 'scheduler')
  await publishOrFallback(event)
} finally {
  await releaseLock(...)
}
```
Log one line per check with `eventId`, `monitorId`, `status`, `responseTimeMs`, and which path was used (`queue` or `fallback`).

### 8.2 Publish with fallback
`publishOrFallback(event)`:
1. `queue.publish(event)`. If it succeeds, done.
2. If it throws and `QUEUE_FALLBACK_TO_DB=true`, call `recordResult(event)` and `setStatus` directly (the same code path the consumer uses), log a warning with `path: "fallback"`. Because `eventId` is unique, a later duplicate cannot create a second row.
3. If it throws and the fallback is disabled or also fails, log an error. The result is lost for that interval.

### 8.3 Manual check
`POST /api/monitors/:id/check` stays **synchronous** (it must return the new result and the updated monitor in the response). It builds an event with `source: "manual"` and calls `recordResult(event)` and `setStatus` directly. Document this "fast path" in the README. It does not use the Redis lock.

### 8.4 Retention
Unchanged from V1, and runs only in the `scheduler` role.

---

## 9. Database Changes

### 9.1 Migration `1700000000005_add-check-result-event-id.sql`
```sql
-- Up Migration
ALTER TABLE check_results
  ADD COLUMN event_id uuid NOT NULL DEFAULT gen_random_uuid();   -- existing rows get random ids

ALTER TABLE check_results
  ADD CONSTRAINT check_results_event_id_uq UNIQUE (event_id);

-- Down Migration
ALTER TABLE check_results DROP CONSTRAINT check_results_event_id_uq;
ALTER TABLE check_results DROP COLUMN event_id;
```
Run it through the project's existing migration script, so it is recorded in `pgmigrations`. Do not apply it by hand.

### 9.2 `recordResult(event)` (replaces V1's signature)
In `src/modules/results/result.service.ts`:

```ts
recordResult(event: CheckResultEvent): Promise<{ inserted: boolean; applied: boolean; previousStatus: 'pending'|'up'|'down'|null }>
```
In one transaction:
1. `INSERT INTO check_results (event_id, monitor_id, checked_at, status, status_code, response_time_ms, error) VALUES (...) ON CONFLICT (event_id) DO NOTHING RETURNING id`. No row returned means a duplicate: return `{ inserted: false, applied: false, previousStatus: null }`.
2. Read the monitor's current `current_status` with `SELECT ... FOR UPDATE` (this is `previousStatus`, and it serializes concurrent writers for one monitor).
3. `UPDATE monitors SET current_status, last_checked_at, last_response_time_ms, last_status_code, last_error, consecutive_failures = CASE WHEN $status = 'up' THEN 0 ELSE consecutive_failures + 1 END, updated_at = now() WHERE id = $1 AND (last_checked_at IS NULL OR last_checked_at <= $checkedAt)`. Rows updated greater than zero means `applied: true`.
4. A foreign key violation (`23503`) is allowed to propagate as an error; the consumer treats it per section 7.5.

All V1 call sites move to this signature.

---

## 10. API Changes

### 10.1 Changed behavior (response shapes unchanged)
| Endpoint | Change |
|---|---|
| `GET /api/monitors`, `GET /api/monitors/:id` | Read monitor rows from Postgres, then overlay `currentStatus`, `lastCheckedAt`, `lastResponseTimeMs`, `lastStatusCode`, `lastError` from the Redis status cache where an entry exists. Missing entries use the row values. |
| `DELETE /api/monitors/:id` | Also calls `deleteStatus(id)` |
| `POST /api/monitors/:id/check` | Per section 8.3 |
| All rate-limited routes | Redis-backed store (section 5.6) |
| `GET /health` | Adds `"redis": "up" or "down"` and `"queue": "up" or "down"`. **Status code stays 200 if Postgres is up**, even if Redis or the queue are down (the service still works), and 503 only when Postgres is down. Overall `status` is `"ok"` or `"degraded"`. |

### 10.2 New endpoint: `GET /api/system/pipeline`
Auth: Bearer. Not user-specific, and it exposes no secrets (only booleans and counts). Subject to the global rate limit. Cache the computed response in memory for 5 seconds.

```json
{
  "state": "healthy",
  "reason": null,
  "queueDriver": "kafka",
  "redis": { "status": "up" },
  "queue": { "status": "up", "lag": 0, "dlqDepth": 0 },
  "lastProcessedAt": "2026-01-01T10:00:00.000Z",
  "checkedAt": "2026-01-01T10:00:05.000Z"
}
```

| Field | Rules |
|---|---|
| `state` | `degraded` if Redis or the queue is unreachable. Else `lagging` if `queue.lag` is greater than `PIPELINE_LAG_WARN` (default 50). Else `healthy`. |
| `reason` | `null`, `"redis"`, `"queue"`, or `"redis_and_queue"` (only set when `state` is `degraded`) |
| `queue.lag` | Number, or `null` if unknown |
| `queue.dlqDepth` | Number, or `null` if unknown |
| `lastProcessedAt` | From `pipeline:last_processed`, or `null` |

---

## 11. Frontend Changes

Only one addition. No new env vars. Follow `design.md` for all styling.

### 11.1 Pipeline card
A clay card at the bottom of the dashboard, below the monitor grid, full width. Data from `GET /api/system/pipeline` with `refetchInterval: 10000`.

```text
┌──────────────────────────────────────────────────────────────────┐
│ (orb sm)  Pipeline healthy                                       │
│           Results are saved as soon as they arrive.              │
│                                                                  │
│  Queue        Waiting       Failed        Last saved             │
│  Kafka        0             0             4s ago                 │
└──────────────────────────────────────────────────────────────────┘
```

| `state` | Orb | Title | Message |
|---|---|---|---|
| `healthy` | `up` (yellow) | Pipeline healthy | Results are saved as soon as they arrive. |
| `lagging` | `paused` (orange) | Pipeline catching up | `{lag}` results are waiting to be saved. |
| `degraded`, reason `redis` | `down` (red, pulses) | Pipeline degraded | Redis can't be reached. Checks keep running and results are still saved. |
| `degraded`, reason `queue` | `down` | Pipeline degraded | The message queue can't be reached. Results are saved directly until it's back. |
| `degraded`, both | `down` | Pipeline degraded | Redis and the message queue can't be reached. Checks keep running. |
| request failed | `pending` | Pipeline status unavailable | Couldn't load pipeline status. Try again in a moment. |

- Stats row labels: **Queue** (`Kafka` or `Redis Streams`), **Waiting** (`queue.lag`, shown as an en dash when `null`), **Failed** (`queue.dlqDepth`, same rule), **Last saved** (relative time, or "never").
- Stat numbers use Fredoka with tabular numerals, as in `design.md`.
- The orb always sits next to the text label (status is never color alone).
- New files: `src/api/system.ts`, `src/components/PipelineCard.tsx`. Types: `PipelineStatus`.

### 11.2 Frontend container (for the one-command local stack)
`frontend/Dockerfile` (multi-stage: `node:20-alpine` builds with `VITE_API_BASE_URL=/api`, then `nginx:alpine` serves `dist/`) and `frontend/nginx.conf`:

```nginx
server {
  listen 80;
  root /usr/share/nginx/html;

  location /api/ {
    proxy_pass http://api:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location / {
    try_files $uri /index.html;
  }
}
```
This proxy plays the same role locally that the Vercel rewrite plays in production: the browser only talks to one origin, so cookies stay first-party.

---

## 12. Environment Variables

### 12.1 `backend/.env.example` (complete file for V2)

```dotenv
# ---------- Server ----------
NODE_ENV=development              # development | production | test
PORT=8080
LOG_LEVEL=info
TRUST_PROXY=0                     # local npm run dev: 0 | Docker Compose behind nginx: 1 | Render behind Vercel: usually 2
# Which parts of the app this process runs (comma-separated): api, scheduler, consumer
ROLES=api,scheduler,consumer

# ---------- Database ----------
DATABASE_URL=postgres://watcher:watcher@localhost:5432/watcher
DIRECT_DATABASE_URL=              # Neon only: the non-pooled string, used for migrations
DB_POOL_MAX=10

# ---------- Auth ----------
JWT_ACCESS_SECRET=change-me-to-a-long-random-string-at-least-32-chars
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL_DAYS=7
BCRYPT_COST=12                    # use 4 in tests only

# ---------- Cookies / CORS ----------
COOKIE_SECURE=false
COOKIE_SAMESITE=lax
COOKIE_DOMAIN=
CORS_ORIGINS=http://localhost:5173

# ---------- Monitoring behaviour ----------
SCHEDULER_TICK_SECONDS=10
CHECK_CONCURRENCY=10
MIN_INTERVAL_SECONDS=60
MAX_MONITORS_PER_USER=10
DEFAULT_TIMEOUT_MS=10000
RESULT_RETENTION_DAYS=7
ALLOW_PRIVATE_TARGETS=false       # never true in production

# ---------- Redis ----------
REDIS_URL=redis://localhost:6379  # production: rediss://default:PASSWORD@HOST:PORT
REDIS_KEY_PREFIX=watcher:
STATUS_CACHE_TTL_SECONDS=86400
LOCK_TTL_BUFFER_SECONDS=15
RATE_LIMIT_STORE=redis            # redis | memory (memory is for tests)

# ---------- Queue ----------
QUEUE_DRIVER=kafka                # kafka | redis-streams | memory (memory is for tests only)
QUEUE_FALLBACK_TO_DB=true         # if publishing fails, write the result directly
PUBLISH_TIMEOUT_MS=5000
CONSUMER_MAX_ATTEMPTS=3
CONSUMER_RETRY_BASE_MS=200
PIPELINE_LAG_WARN=50
REDIS_STREAM_MAXLEN=10000         # redis-streams driver only

# ---------- Kafka (used when QUEUE_DRIVER=kafka) ----------
KAFKA_BROKERS=localhost:9092      # comma-separated host:port list
KAFKA_CLIENT_ID=watcher
KAFKA_SSL=false                   # true for managed Kafka
KAFKA_SASL_MECHANISM=             # empty | plain | scram-sha-256 | scram-sha-512
KAFKA_USERNAME=
KAFKA_PASSWORD=
KAFKA_TOPIC_RESULTS=check.results
KAFKA_TOPIC_DLQ=check.results.dlq
KAFKA_TOPIC_PARTITIONS=3
KAFKA_AUTO_CREATE_TOPICS=true     # false on managed Kafka: create the topics in its console
KAFKA_CONSUMER_GROUP=watcher-result-writers
```

Notes:
- `SCHEDULER_ENABLED` from V1 is **removed**. Whether the scheduler runs is decided by `ROLES`.
- Boot validation (zod) must additionally enforce: `REDIS_URL` set whenever any role is active; `KAFKA_BROKERS` set when `QUEUE_DRIVER=kafka`; `QUEUE_DRIVER` is not `memory` when `NODE_ENV=production`; `RATE_LIMIT_STORE` is not `memory` when `NODE_ENV=production`.
- Never log `REDIS_URL`, `KAFKA_PASSWORD`, or the SASL config.
- Docker Compose overrides the host-based values with service names (section 13).

### 12.2 `frontend/.env.example`
**No changes from V1.**

---

## 13. Docker Compose (full local stack)

`docker-compose.yml` at the repo root. Infrastructure services are usable on their own (`docker compose up -d db redis kafka`) while you run the app with `npm run dev`.

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: watcher
      POSTGRES_PASSWORD: watcher
      POSTGRES_DB: watcher
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U watcher"]
      interval: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      retries: 10

  kafka:
    image: apache/kafka:3.9.1
    ports: ["9092:9092"]
    environment:
      KAFKA_NODE_ID: 1
      KAFKA_PROCESS_ROLES: broker,controller
      KAFKA_LISTENERS: INTERNAL://:19092,EXTERNAL://:9092,CONTROLLER://:9093
      KAFKA_ADVERTISED_LISTENERS: INTERNAL://kafka:19092,EXTERNAL://localhost:9092
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: INTERNAL:PLAINTEXT,EXTERNAL:PLAINTEXT,CONTROLLER:PLAINTEXT
      KAFKA_INTER_BROKER_LISTENER_NAME: INTERNAL
      KAFKA_CONTROLLER_LISTENER_NAMES: CONTROLLER
      KAFKA_CONTROLLER_QUORUM_VOTERS: 1@kafka:9093
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
      KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: 1
      KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: 1
      KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS: 0
      KAFKA_AUTO_CREATE_TOPICS_ENABLE: "false"
    healthcheck:
      test: ["CMD-SHELL", "/opt/kafka/bin/kafka-broker-api-versions.sh --bootstrap-server localhost:9092 > /dev/null 2>&1"]
      interval: 10s
      timeout: 10s
      retries: 12

  migrate:
    build: ./backend
    command: ["npm", "run", "migrate"]
    environment: &app-env
      NODE_ENV: development
      DATABASE_URL: postgres://watcher:watcher@db:5432/watcher
      JWT_ACCESS_SECRET: local-dev-secret-change-me-at-least-32-characters-long
      REDIS_URL: redis://redis:6379
      QUEUE_DRIVER: kafka
      KAFKA_BROKERS: kafka:19092
      KAFKA_AUTO_CREATE_TOPICS: "true"
      CORS_ORIGINS: http://localhost:3000
      TRUST_PROXY: "1"
    depends_on:
      db: { condition: service_healthy }

  api:
    build: ./backend
    command: ["node", "dist/server.js"]
    environment:
      <<: *app-env
      ROLES: api
      PORT: "8080"
    depends_on:
      migrate: { condition: service_completed_successfully }
      redis: { condition: service_healthy }
      kafka: { condition: service_healthy }

  scheduler:
    build: ./backend
    command: ["node", "dist/server.js"]
    environment:
      <<: *app-env
      ROLES: scheduler
    depends_on:
      migrate: { condition: service_completed_successfully }
      redis: { condition: service_healthy }
      kafka: { condition: service_healthy }

  consumer:
    build: ./backend
    command: ["node", "dist/server.js"]
    environment:
      <<: *app-env
      ROLES: consumer
    depends_on:
      migrate: { condition: service_completed_successfully }
      redis: { condition: service_healthy }
      kafka: { condition: service_healthy }

  web:
    build: ./frontend
    ports: ["3000:80"]
    depends_on: [api]

volumes:
  pgdata:
```

Requirements:
- The backend `Dockerfile` from V1 must also copy `scripts/` (the migration script) and `migrations/` into the runtime image.
- Do not set `container_name` on `scheduler` or `consumer`, so `docker compose up --scale scheduler=2` works.
- Set `MIN_INTERVAL_SECONDS` low (for example `30`) only in a local override if you want faster demos, and keep the default in the repo.
- Local app URL when using Compose: `http://localhost:3000`. Local app URL when running `npm run dev`: `http://localhost:5173`.

---

## 14. Folder Structure Changes

```
backend/
├── scripts/migrate.mjs                      # must print each applied migration
├── migrations/1700000000005_add-check-result-event-id.sql
├── src/
│   ├── server.ts                            # starts only the roles in ROLES
│   ├── roles.ts                             # parseRoles + start/stop per role
│   ├── redis/        (client.ts, lock.ts, statusCache.ts)
│   ├── queue/        (types.ts, index.ts, event.ts, kafka.queue.ts, redisStreams.queue.ts, memory.queue.ts)
│   ├── consumer/     (consumer.ts, handleMessage.ts)
│   ├── scheduler/    (scheduler.ts, publish.ts, retention.ts)    # publish.ts = publishOrFallback
│   └── modules/system/ (system.routes.ts, pipeline.service.ts)
└── tests/
    ├── queue.contract.ts
    ├── handleMessage.test.ts
    ├── recordResult.test.ts                 # extended
    ├── lock.test.ts
    └── statusCache.test.ts
frontend/
├── Dockerfile
├── nginx.conf
└── src/ (api/system.ts, components/PipelineCard.tsx)
docker-compose.yml                           # replaced by section 13
```

`package.json` additions: dependencies `kafkajs`, `ioredis`, `rate-limit-redis`; dev dependency `cross-env`. Scripts: `dev` (`cross-env ROLES=api,scheduler,consumer tsx watch src/server.ts`), `dev:api`, `dev:scheduler`, `dev:consumer` (each sets a single role with `cross-env`), `test` (unit tests, memory driver), `test:integration` (needs `docker compose up -d db redis kafka`).

---

## 15. Testing Requirements

**Unit tests** (`npm test`, memory queue, no Docker needed beyond Postgres):
1. `recordResult`: a duplicate `eventId` inserts once. An older event is inserted but does not change the monitor's latest state (`applied: false`). `consecutive_failures` increments on down and resets on up. Returns the correct `previousStatus`.
2. `handleMessage`: invalid JSON goes to the DLQ without retries. A handler that fails twice then succeeds is acknowledged without DLQ. A handler that always fails is retried `CONSUMER_MAX_ATTEMPTS` times, then goes to the DLQ. A deleted monitor (FK violation) is acknowledged with no DLQ. If the DLQ publish fails, the handler throws.
3. Event schema: accepts a valid event, rejects unknown fields, bad UUIDs, and `schemaVersion` other than 1.
4. `publishOrFallback`: when `publish` throws and fallback is on, the result is stored once. When fallback is off, nothing is stored and the error is logged.

**Integration tests** (`npm run test:integration`, real Redis and Kafka from Compose):
5. Lock: a second `acquireLock` on the same key returns `null`. `releaseLock` with a wrong token does not release. The lock expires after its TTL.
6. Status cache: `setStatus` then `getStatuses` round-trips and converts empty values back to `null`. With Redis stopped, `getStatuses` returns an empty map without throwing.
7. Queue contract suite against `redis-streams` and `kafka` (section 6.5).
8. API: `GET /api/monitors` returns overlaid status from the cache when present and DB values when not.

---

## 16. Deployment Requirements

| Piece | Setup |
|---|---|
| **Neon** | Unchanged. Run migration 5 through the normal start command. |
| **Redis** | A managed instance reachable from Render, using a `rediss://` URL. Options: Upstash Redis or Render Key Value. Free tiers are in-memory and can lose data on restart, which is fine because Redis only holds disposable data (section 3.5). Check each provider's current free-tier limits and which connection URL works from a free Render web service. |
| **Kafka** | **Option A (headline):** a managed Kafka with a free or credit-based tier, such as Confluent Cloud (Basic) or Redpanda Serverless. Create the topics `check.results` (3 partitions) and `check.results.dlq` (1 partition) in the console, create an API key, then set `KAFKA_SSL=true`, `KAFKA_SASL_MECHANISM`, `KAFKA_USERNAME`, `KAFKA_PASSWORD`, `KAFKA_BROKERS`, and `KAFKA_AUTO_CREATE_TOPICS=false`. Confirm the current free tier terms and whether a card is required before you rely on it. **Option B (fallback):** `QUEUE_DRIVER=redis-streams`. The README must say plainly that production uses Redis Streams and that the Kafka driver is exercised locally and in tests. |
| **Render** | Still **one free web service**. Set `ROLES=api,scheduler,consumer`, the Redis and queue variables, and keep the V1 variables. Build and start commands are unchanged. |
| **Vercel** | Unchanged (no new env vars). |

Operational notes for the README:
- The free Render instance sleeps after about 15 minutes without inbound traffic, and the scheduler and consumer sleep with it. When it wakes, the consumer resumes from its committed offset, which also makes a nice demo of catch-up.
- Keep intervals at 60 seconds or more and the monitor count low. Render can suspend a free service that generates an unusually high volume of outbound traffic, and Kafka, Redis, and Neon connections all count as outbound traffic from a free service.
- A single process running all three roles loses the failure isolation that separate containers give locally. State this trade-off honestly.

---

## 17. Acceptance Criteria (Definition of Done)

Local, with `docker compose up --build`:
1. Everything starts without manual steps, and the app works at `http://localhost:3000` (register, add monitor, see it go **Up**).
2. Logs show, for one check, a `publish` line from the scheduler and a `consumed` line from the consumer with the **same `eventId`**.
3. The Kafka topic contains the events:
   `docker compose exec kafka /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic check.results --from-beginning --max-messages 3`
4. **Catch-up demo:** `docker compose stop consumer`. New checks keep being published, no new rows appear in `check_results`, and the Pipeline card changes to **catching up** with a growing "Waiting" number. `docker compose start consumer`. The card returns to **healthy**, and the number of stored rows equals the number of published events (no gaps, no duplicates).
5. **Idempotency:** publishing an event with an existing `eventId` (a small script is provided in the implementation plan) does not create a second row.
6. **Poison message:** sending invalid JSON to `check.results` lands it in `check.results.dlq`, the consumer keeps running, and the card shows **Failed: 1**.
7. **Redis outage:** `docker compose stop redis`. The dashboard still loads with correct statuses (fallback to Postgres), checks still run, and the card shows **degraded (Redis)**. `docker compose start redis`. Everything recovers without restarting any container.
8. **Kafka outage:** `docker compose stop kafka`. The scheduler logs `path: "fallback"` and results are still stored in Postgres, and the card shows **degraded (queue)**. After `docker compose start kafka`, publishing resumes and the card returns to **healthy**.
9. **Two schedulers:** `docker compose up -d --scale scheduler=2`. Each monitor still gets about one check per interval (verify with a count query over a 10 minute window).
10. **Driver switch:** with `QUEUE_DRIVER=redis-streams` (Kafka not needed), criteria 1, 2, 4, 5, and 6 behave the same.
11. Rate-limit counters survive an `api` container restart (11 bad logins before and after a restart still produce a `429` on the 11th).
12. `npm test` and `npm run test:integration` pass.

Production:
13. The deployed app works end to end with managed Redis and either managed Kafka or Redis Streams, the README states which one is used and why, and the Pipeline card shows **healthy**.
14. Repo committed and tagged `v2`.

---

## 18. Risks and Decisions

| Risk or decision | Mitigation |
|---|---|
| Managed Kafka free tiers change or need a card | Redis Streams driver behind the same interface, with an honest README note |
| `kafkajs` is lightly maintained | Pin the local broker to 3.9.x. The queue interface allows swapping to `@confluentinc/kafka-javascript` |
| At-least-once delivery creates duplicates | Unique `event_id` and `ON CONFLICT DO NOTHING` |
| Late or out-of-order events overwrite newer state | `last_checked_at` guard on the monitor update |
| Redis outage | Redis holds only disposable data. Every use has a fallback (section 5.5) |
| Fail-open rate limiting during a Redis outage weakens brute-force protection | Accepted for V2 and documented. Argon2 or bcrypt cost still slows guessing. Revisit with an in-memory fallback limiter if needed. |
| A skipped check when the lock is already held | Logged at debug. The next interval checks the monitor normally. |
| All roles in one free Render process | Roles are separate locally and in the code. State the trade-off in the README |
| Free Render instance sleeps | Documented. The consumer catches up from its committed offset on wake |
| Lag and DLQ depth need broker admin permissions on managed Kafka | If the admin calls fail, `getStats` returns `null` values and the card shows an en dash, never an error |
