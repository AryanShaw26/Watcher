# Watcher V2: Implementation Plan

> **Your APIs. Always in Sight.**

Companion to `PRD-v2.md`. The PRD says **what** changes. This file says **in what order**, and how to check each step before moving on.

## How to use this with an AI agent

1. Put `PRD-v2.md` and this file in `docs/` next to `PRD.md`, `implementation.md`, and `design.md`.
2. Start the agent session with this **master prompt**:

   > Read `docs/PRD-v2.md` fully. It describes only what changes from Version 1, so also keep `docs/PRD.md` and `docs/design.md` in mind. We are building Version 2 step by step following `docs/implementation-v2.md`. Do only the step I name. Use the exact file names, keys, topics, columns, and env vars from the PRD. Don't add Version 3 features. Do not change V1 behavior unless the PRD says so. After each step, tell me how to verify it.

3. Send one step at a time: *"Do Step N from implementation-v2.md."*
4. Run the **Verify** block yourself. Do not move on until it passes.
5. **Commit after every step** on a `v2` branch. If the agent breaks something, you can roll back.
6. Read what the agent wrote. In an interview, the failure-handling code is what you will be asked about.

**Time budget (about one to one and a half days):**

| Block | Steps | Rough time |
|---|---|---|
| Foundation | 0 to 3 | 2 h |
| Core pipeline | 4 to 7 | 4 h |
| Cache, limits, second driver | 8 to 10 | 2.5 h |
| UI and tests | 11 to 12 | 2 h |
| Full stack and deploy | 13 to 14 | 3 h |
| Finish | 15 to 16 | 1 h |

---

## Step 0: Version 1 gate (do not skip)

V2 builds on V1, so V1 must be solid first. Check all of this yourself:

- [ ] `npm run migrate` **prints each migration it applies** (or says there is nothing to apply), and `select name from pgmigrations;` shows all four V1 migrations. If you created the tables by hand earlier, fix this now: ask the agent to replace `scripts/migrate.mjs` with a script that runs `node-pg-migrate` properly and prints its output, then confirm on an empty test database that it creates everything. V2 adds a fifth migration, and Neon will need the migration tool to work.
- [ ] `npm test` passes in `backend`.
- [ ] V1 is deployed and works (Vercel, Render, Neon), or at least runs fully locally.
- [ ] Everything is committed and tagged `v1`.

Then create the branch:
```bash
git checkout -b v2
```

---

## Step 1: Infrastructure: Redis and Kafka in Compose

**Goal:** Postgres, Redis, and Kafka all run locally and are healthy. No app code changes yet.

**Tasks**
1. Replace `docker-compose.yml` with the `db`, `redis`, and `kafka` services from PRD section 13. (Add the app services in Step 13.)
2. Keep the volume `pgdata`.

**Verify**
```bash
docker compose up -d db redis kafka
docker compose ps                         # all three "healthy" (Kafka can take 30-60 s)
docker compose exec redis redis-cli ping  # PONG
docker compose exec kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list   # empty list, no error
```

**If Kafka keeps restarting:** run `docker compose logs kafka`. The most common causes are a wrong image tag (use the newest 3.9.x) or port 9092 already in use.

**Commit:** `step 1: redis and kafka in compose`

---

## Step 2: Config, roles, and scripts

**Goal:** the app starts only the parts named in `ROLES`, with all new env vars validated. Behavior is otherwise unchanged.

**Tasks**
1. Install:
   ```bash
   cd backend
   npm i kafkajs ioredis rate-limit-redis
   npm i -D cross-env
   ```
2. Replace `backend/.env.example` with the full V2 file from PRD 12.1, then update your own `.env` to match (keep your real `DATABASE_URL` and `JWT_ACCESS_SECRET`).
3. Extend `src/config/env.ts` with every new variable (types, defaults) and the extra boot validation rules from PRD 12.1. Remove `SCHEDULER_ENABLED`.
4. `src/roles.ts`: `parseRoles(env.ROLES)` returning a set of `api | scheduler | consumer` (reject unknown names). For now, `startRoles()` starts the existing API when `api` is present and the existing V1 scheduler when `scheduler` is present, and `stopRoles()` stops them. `consumer` can be a no-op placeholder for now.
5. Update `src/server.ts` to use `startRoles()` and graceful shutdown through `stopRoles()`. The HTTP server starts only for the `api` role.
6. Update the npm scripts per PRD 14 (`dev`, `dev:api`, `dev:scheduler`, `dev:consumer` using `cross-env`).

**Verify**
```bash
npm run dev:api            # starts HTTP only; no scheduler logs
npm run dev:scheduler      # no HTTP listener; scheduler ticks
npm run dev                # everything, same as V1
# ROLES=nonsense must exit with a clear config error
npx cross-env ROLES=nonsense tsx src/server.ts
```

**Commit:** `step 2: roles and config`

---

## Step 3: Redis client, lock, and status cache

**Goal:** the three Redis building blocks from PRD section 5, tested in isolation.

**Tasks**
1. `src/redis/client.ts`: the shared `ioredis` client with the options from PRD 5.1, `redisIsUp()`, and a `closeRedis()`. Never log the URL.
2. `src/redis/lock.ts`: `acquireLock` and `releaseLock` (Lua compare-and-delete), failing **open** if Redis is unreachable (PRD 5.3).
3. `src/redis/statusCache.ts`: `setStatus`, `getStatuses` (one pipeline), `deleteStatus`. All swallow errors with a warn log (PRD 5.4).
4. Add `closeRedis()` to graceful shutdown.
5. Extend `GET /health` with the `redis` field and the `degraded` rule from PRD 10.1. (The `queue` field comes in Step 6.)
6. Write the integration tests for the lock and the cache (PRD section 15, items 5 and 6) in `tests/lock.test.ts` and `tests/statusCache.test.ts`. They need the Compose Redis running.

**Verify**
```bash
npm run test:integration -- lock statusCache     # or: npx vitest run tests/lock.test.ts tests/statusCache.test.ts
curl localhost:8080/health                       # "redis":"up"
docker compose stop redis
curl localhost:8080/health                       # still 200, status "degraded", "redis":"down"
docker compose start redis
curl localhost:8080/health                       # back to "ok" without restarting the app
```

**Commit:** `step 3: redis lock and status cache`

---

## Step 4: Migration 5 and the new `recordResult`

**Goal:** idempotent, order-safe result storage. Still no queue: V1's scheduler keeps working through the new function.

**Tasks**
1. Add `migrations/1700000000005_add-check-result-event-id.sql` exactly as in PRD 9.1, and run it with `npm run migrate`.
2. `src/queue/event.ts`: the zod `CheckResultEvent` schema (`.strict()`), the type, and `buildEvent(monitor, outcome, source)` (uses `crypto.randomUUID()`).
3. Rewrite `recordResult(event)` in `src/modules/results/result.service.ts` per PRD 9.2: insert with `ON CONFLICT (event_id) DO NOTHING`, `SELECT ... FOR UPDATE` for `previousStatus`, the guarded update, and the return value `{ inserted, applied, previousStatus }`.
4. Update every V1 call site to build an event and call the new function: the V1 scheduler and `POST /api/monitors/:id/check` (with `source: 'manual'`). After a successful call with `applied: true`, also call `setStatus(...)`.
5. Extend `tests/recordResult.test.ts` with the cases from PRD 15, item 1.

**Verify**
```bash
npm run migrate
# psql: \d check_results shows event_id uuid NOT NULL, with constraint check_results_event_id_uq
npm test -- recordResult
npm run dev     # V1 behavior still works: add a monitor, results appear
```
In psql, confirm no duplicates are possible:
```sql
select event_id, count(*) from check_results group by 1 having count(*) > 1;   -- 0 rows
```

**Commit:** `step 4: idempotent recordResult`

---

## Step 5: Queue interface, memory driver, and the shared handler

**Goal:** the abstraction and all the failure-handling logic, tested without any broker.

**Tasks**
1. `src/queue/types.ts`: `QueueMessage` and `ResultQueue` exactly as in PRD 6.1.
2. `src/queue/memory.queue.ts`: an in-process implementation (an array plus a registered handler). Add a `drain()` test helper that resolves when all queued messages have been handled. Refuse to start when `NODE_ENV=production`.
3. `src/consumer/handleMessage.ts`: the full behavior from PRD section 7:
   - validate, with poison messages going to the DLQ immediately
   - `recordResult` with retries and backoff `base * 4^(attempt-1)`
   - cache update and `pipeline:last_processed`
   - the non-error cases in 7.5 (duplicate, deleted monitor `23503`, out-of-order)
   - DLQ after the final failure, and a throw only if the DLQ publish fails
   Make the retry delay function injectable so tests do not actually wait.
4. `src/queue/index.ts`: `createQueue(env)`, with only `memory` implemented for now (others throw "not implemented yet").
5. `src/consumer/consumer.ts`: `startConsumer(queue)` which calls `queue.consume(handleMessage)`. Wire it to the `consumer` role in `roles.ts`.
6. Write `tests/handleMessage.test.ts` for PRD 15, item 2, and the event schema tests (item 3).
7. Write the shared `tests/queue.contract.ts` suite (PRD 6.5) and run it against the memory driver.

**Verify**
```bash
npm test      # handleMessage, event schema, contract (memory) all pass
```
Read `handleMessage.ts` once, slowly. This file is the heart of the failure handling.

**Commit:** `step 5: queue interface and handler`

---

## Step 6: Kafka driver

**Goal:** the real broker, behind the same interface.

**Tasks**
1. `src/queue/kafka.queue.ts` per PRD 6.3: client setup (SSL and SASL optional), topic creation or verification, idempotent producer, consumer with `eachMessage`, DLQ publishing with headers, and `getStats()` with the 5 second cache. Route kafkajs logs into pino.
2. Register it in `createQueue`.
3. Add the `queue` field to `GET /health` (`up` if `getStats().connected`).
4. Add a small script `scripts/replay-event.ts` (and an npm script `event:replay`) that publishes one event with a given `eventId` and `monitorId`, for the idempotency demo. It must fail clearly if `monitorId` is missing.
5. Run the queue contract suite against Kafka in the integration test command.

**Verify** (infrastructure from Step 1 running)
```bash
npm run migrate
npm run dev                 # watch for "topics ready" and "consumer started" logs
docker compose exec kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list
# check.results and check.results.dlq are listed
docker compose exec kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --describe --topic check.results
# 3 partitions
npm run test:integration -- queue     # contract suite against kafka passes
```

**Commit:** `step 6: kafka driver`

---

## Step 7: Scheduler publishes events

**Goal:** the full pipeline: scheduler, lock, check, publish, consumer, Postgres.

**Tasks**
1. `src/scheduler/publish.ts`: `publishOrFallback(event)` per PRD 8.2, including the `QUEUE_FALLBACK_TO_DB` behavior and the `path` field in the log line.
2. Update `src/scheduler/scheduler.ts` per PRD 8.1: keep V1's claim and loop, add the per-monitor lock (TTL `timeoutMs + LOCK_TTL_BUFFER_SECONDS`), build the event, `publishOrFallback`, release in `finally`. Skip silently (debug log) when the lock is held. Remove the direct `recordResult` call from the scheduler path (it now only happens inside `publishOrFallback` fallback).
3. Retention job runs in the `scheduler` role only.
4. Write `tests/publishOrFallback.test.ts` for PRD 15, item 4.

**Verify** (local infra up, `npm run dev` with all roles)
```bash
# 1) Add a monitor for https://example.com (interval 60) in the UI.
# 2) Logs show, per check:  scheduler "published" {eventId=X}  ->  consumer "consumed" {eventId=X}
# 3) Messages are in Kafka:
docker compose exec kafka /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic check.results --from-beginning --max-messages 3
# 4) Consumer group is caught up (LAG column = 0):
docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group watcher-result-writers
```

**Catch-up demo (run the roles separately in three terminals):**
```bash
# terminal A
npm run dev:api
# terminal B
npm run dev:scheduler
# terminal C
npm run dev:consumer
```
Stop terminal C (Ctrl+C) and wait for a few checks. Results stop appearing in the dashboard, and the consumer group LAG grows. Start `npm run dev:consumer` again: LAG returns to 0 and the missing results appear. Save this in your notes. It is your best demo moment.

**Fallback check:** `docker compose stop kafka`, wait one check cycle. The scheduler logs `path: "fallback"` and the result still appears in the dashboard. `docker compose start kafka` and publishing resumes on its own.

**Commit:** `step 7: scheduler publishes to kafka`

---

## Step 8: Status cache in the API

**Goal:** the dashboard reads status through Redis, with Postgres as the safety net.

**Tasks**
1. In `monitor.service.ts`, after loading monitor rows for `GET /api/monitors` and `GET /api/monitors/:id`, call `getStatuses(ids)` and overlay `currentStatus`, `lastCheckedAt`, `lastResponseTimeMs`, `lastStatusCode`, `lastError` where a cache entry exists (PRD 10.1).
2. `deleteMonitor` also calls `deleteStatus(id)`.
3. Add the API integration test (PRD 15, item 8).

**Verify**
```bash
# With a monitor running, inspect the cache:
docker compose exec redis redis-cli --scan --pattern "watcher:status:*"
docker compose exec redis redis-cli hgetall "watcher:status:<monitor-id>"
# Prove the fallback: clear the cache; the dashboard must still show correct data
docker compose exec redis redis-cli flushall
# Reload the dashboard: statuses still correct (from Postgres). Within one interval the cache refills.
docker compose stop redis      # dashboard still loads; checks continue; /health says degraded
docker compose start redis     # recovers on its own
```

**Commit:** `step 8: status cache overlay`

---

## Step 9: Redis-backed rate limiting

**Goal:** the four V1 limiters share state through Redis.

**Tasks**
1. In `middleware/rateLimit.ts`, use `RedisStore` from `rate-limit-redis` with the shared client (`sendCommand`) and a distinct key prefix per limiter (`rl:global:`, `rl:login:`, `rl:register:`, `rl:check:`). Set `passOnStoreError: true`. Use the in-memory store when `RATE_LIMIT_STORE=memory`.
2. Do not change limits, windows, or error format.

**Verify**
```bash
# 11 bad logins -> the 11th returns 429
# Restart the API process (Ctrl+C, npm run dev:api), send one more bad login -> still 429 (counter survived)
docker compose exec redis redis-cli --scan --pattern "watcher:rl:*"
docker compose stop redis      # login attempts still respond (fail open), a warning is logged
docker compose start redis
```

**Commit:** `step 9: redis rate limiting`

---

## Step 10: Redis Streams driver

**Goal:** a second real implementation of the queue interface, selectable by env var.

**Tasks**
1. `src/queue/redisStreams.queue.ts` per PRD 6.4: `XADD` with `MAXLEN ~`, consumer group with `MKSTREAM`, `XREADGROUP` loop on a dedicated connection, `XACK`, `XAUTOCLAIM` recovery, DLQ stream, and `getStats()`.
2. Register it in `createQueue` for `QUEUE_DRIVER=redis-streams`.
3. Add it to the contract suite in the integration test command.
4. In `/health` and `/api/system/pipeline` (Step 11) the stats come from the active driver.

**Verify**
```bash
# Set QUEUE_DRIVER=redis-streams in .env (Kafka not required for this run), restart
npm run dev
# Logs show the same published/consumed pairs. Then:
docker compose exec redis redis-cli xinfo groups "watcher:stream:check.results"
docker compose exec redis redis-cli xlen "watcher:stream:check.results"
# Kill the consumer mid-run, restart it: no lost events (xinfo groups shows lag back to 0)
npm run test:integration -- queue     # contract suite passes for redis-streams too
# Set QUEUE_DRIVER back to kafka when done
```

**Commit:** `step 10: redis streams driver`

---

## Step 11: Pipeline endpoint and card

**Goal:** make the architecture visible in the UI.

**Tasks (backend)**
1. `modules/system/pipeline.service.ts`: combine `redisIsUp()`, `queue.getStats()`, and `pipeline:last_processed` into the response from PRD 10.2, with the `state` and `reason` rules and `PIPELINE_LAG_WARN`. Cache the result for 5 seconds in memory.
2. `modules/system/system.routes.ts`: `GET /api/system/pipeline`, protected with `requireAuth`. Mount at `/api/system`.
3. The `api` role must be able to call `queue.getStats()` without consuming. Create the queue client in the `api` role in a read-only mode (no consumer started).

**Tasks (frontend)**
4. `src/api/system.ts` with the `PipelineStatus` type and a fetch function.
5. `src/components/PipelineCard.tsx` per PRD 11.1 and `design.md` (clay card, orb `sm`, state table, stat row with tabular numerals, `refetchInterval: 10000`). Add it to the bottom of the Dashboard page.
6. Copy must match the PRD table exactly (sentence case, no all-caps labels).

**Verify**
```bash
curl -H "authorization: Bearer $T" localhost:8080/api/system/pipeline
```
In the browser:
- [ ] Card shows **Pipeline healthy** with an up (yellow) orb.
- [ ] Stop the consumer: card turns to **catching up** (orange) and "Waiting" climbs. Start it: back to **healthy**.
- [ ] Stop Redis: **degraded** (red, pulsing) with the Redis message. Stop Kafka: degraded with the queue message.
- [ ] Waiting and Failed show an en dash when the broker is unreachable, never an error banner.
- [ ] Looks right at 360px width and under reduced motion (no pulse).

**Commit:** `step 11: pipeline card`

---

## Step 12: Tests

**Goal:** the full test list from PRD section 15 passes.

**Tasks**
1. Make sure all tests from PRD 15, items 1 to 8, exist and pass.
2. `npm test` must run **without** Redis and Kafka (memory driver, memory rate-limit store, and Postgres only). `npm run test:integration` runs everything and needs `docker compose up -d db redis kafka`.
3. Add a short "Testing" section to the README explaining the two commands.

**Verify**
```bash
npm test
docker compose up -d db redis kafka
npm run test:integration
```

**Commit:** `step 12: tests`

---

## Step 13: One-command full stack

**Goal:** `docker compose up --build` runs everything, and the failure demos from the acceptance criteria all work.

**Tasks**
1. Update `backend/Dockerfile` so the runtime image includes `dist/`, `migrations/`, `scripts/migrate.mjs`, and production dependencies (`kafkajs`, `ioredis`, `node-pg-migrate`, and the rest). Keep running as a non-root user.
2. `frontend/Dockerfile` and `frontend/nginx.conf` per PRD 11.2.
3. Add `migrate`, `api`, `scheduler`, `consumer`, and `web` services to `docker-compose.yml` per PRD section 13.
4. Make sure that `docker compose up --build` from a clean checkout works: it runs migrations once, then starts the roles.

**Verify** (this is PRD acceptance criteria 1 to 9)
```bash
docker compose down -v
docker compose up --build
# open http://localhost:3000 and register, add a monitor for https://example.com
```
Then run each scenario:

```bash
# A. Catch-up
docker compose stop consumer          # card: catching up, Waiting grows
docker compose start consumer         # card: healthy, Waiting 0

# B. Idempotency (use a real monitor id and an existing event id from the logs)
docker compose exec api node dist/scripts/replay-event.js <eventId> <monitorId>   # twice; only one row
#    (if the script is run through tsx instead, use the npm script you created in Step 6)

# C. Poison message (PowerShell)
"this is not json" | docker compose exec -T kafka /opt/kafka/bin/kafka-console-producer.sh --bootstrap-server localhost:9092 --topic check.results
#    Card: Failed 1. Consumer keeps running.
docker compose exec kafka /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic check.results.dlq --from-beginning --max-messages 1 --property print.headers=true

# D. Redis outage
docker compose stop redis             # app works, card: degraded (Redis)
docker compose start redis            # recovers by itself

# E. Kafka outage
docker compose stop kafka             # logs: path "fallback", results still stored, card: degraded (queue)
docker compose start kafka            # card: healthy again

# F. Two schedulers
docker compose up -d --scale scheduler=2
```
For F, wait about 10 minutes and run this in psql (or pgAdmin) for a monitor with a 60 second interval. Expect about 10 rows per monitor, not 20:
```sql
select monitor_id, count(*) from check_results
where checked_at > now() - interval '10 minutes' group by 1;
```

**Commit:** `step 13: full compose stack`

---

## Step 14: Deploy

**Do these in order. Most of this is dashboards.**

### 14.1 Redis
1. Create a managed Redis (Upstash Redis or Render Key Value). Copy the `rediss://` URL. If you use Render Key Value, check whether the internal or the external URL works from a free web service, and use the one that connects.
2. Free tiers can lose data on restart. That is acceptable here (PRD 3.5).

### 14.2 Queue: choose one

**Option A: managed Kafka (headline)**
1. Create a cluster on Confluent Cloud (Basic) or Redpanda Serverless. Check the current free tier terms and whether a card is required first.
2. Create the topics `check.results` (3 partitions) and `check.results.dlq` (1 partition).
3. Create an API key (or SASL user). Note the bootstrap server, username, and password. Confirm the SASL mechanism the provider uses (Confluent uses `plain`, Redpanda Serverless typically uses `scram-sha-256` or `scram-sha-512`).
4. Render env vars: `QUEUE_DRIVER=kafka`, `KAFKA_BROKERS`, `KAFKA_SSL=true`, `KAFKA_SASL_MECHANISM`, `KAFKA_USERNAME`, `KAFKA_PASSWORD`, `KAFKA_AUTO_CREATE_TOPICS=false`, and `KAFKA_CONSUMER_GROUP=watcher-result-writers`.
5. If the broker rejects the admin calls (lag shows an en dash), that is fine. Publishing and consuming are what matter.

**Option B: Redis Streams (fallback)**
1. Render env var: `QUEUE_DRIVER=redis-streams`.
2. The README must say clearly that production uses Redis Streams, and that the Kafka driver runs locally and in the tests.

### 14.3 Render
1. Add the V2 variables from PRD 12.1 to the existing service: `ROLES=api,scheduler,consumer`, `REDIS_URL`, `REDIS_KEY_PREFIX`, `RATE_LIMIT_STORE=redis`, the queue variables, and the rest. Remove `SCHEDULER_ENABLED` if it is still set.
2. Keep the build and start commands. `start:prod` runs migrations first, so migration 5 is applied through `DIRECT_DATABASE_URL`.
3. Deploy and read the logs: migrations, Redis connected, topics verified (or stream group created), scheduler started, consumer started.

### 14.4 Verify in production
- `curl https://YOUR-SERVICE.onrender.com/health` shows `redis` and `queue` as `up`.
- Open the Vercel app, add a monitor, and watch it go **Up**. The Pipeline card shows **healthy**.
- Let the Render service sleep (15 minutes with no traffic) and then open the app. After the wake-up (about a minute) the consumer catches up. Note this in your README as expected behavior.
- In Neon, `select count(*) from check_results;` grows.

**Commit:** `step 14: v2 deploy config`

---

## Step 15: Documentation

**Tasks**
1. Update `README.md`:
   - New architecture diagram (the Mermaid diagram from PRD 3.1).
   - One-command local start (`docker compose up --build`, then `http://localhost:3000`).
   - A **Design decisions** section: why Kafka (decoupling, multiple consumer groups later), why Redis (locks, cache, shared limits), why both an SQL claim and a Redis lock (PRD 3.4), why Redis is not the source of truth (PRD 3.5), delivery guarantees (PRD 4.3), the fail-open trade-offs (PRD 18).
   - **Failure behavior table:** what happens when the consumer, Redis, or Kafka is down.
   - **Production note** stating exactly which queue driver production uses and why.
   - The **demo script** (the catch-up demo from Step 7), with a GIF or screenshots.
2. Update the roadmap: V3 is alerting, incidents, analytics, CI, and polish.
3. Copy `PRD-v2.md` and `implementation-v2.md` into `docs/`.

**Commit and tag**
```bash
git add -A && git commit -m "v2: event-driven pipeline"
git checkout main && git merge v2
git tag v2 && git push origin main --tags
```

---

## Step 16: Final acceptance check

Go through PRD-v2 section 17 line by line. Local criteria 1 to 12 on the Compose stack, then production criteria 13 and 14.

**Interview-prep list.** You should be able to explain these without looking:
1. Why the producer uses `monitorId` as the message key (per-monitor ordering within a partition).
2. What "at-least-once delivery plus an idempotent write" means, and how `event_id` and `ON CONFLICT DO NOTHING` achieve effectively-once storage.
3. What happens to a duplicate, an out-of-order, a poison, and a failing message (four different answers).
4. Why the SQL claim and the Redis lock are both there, and what each one protects against.
5. Why the DLQ publish failing is the one case where the handler throws.
6. What the consumer does after a crash or a long pause (resumes from its committed offset) and why `fromBeginning: true` matters only for a brand-new group.
7. Why Redis outages never take the app down (every use has a fallback), and the one trade-off (fail-open rate limiting).
8. Why `kafkajs` is hidden behind a `ResultQueue` interface, and how the Redis Streams driver proves it.

---

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Kafka container restarts or is unhealthy | Wrong image tag, port 9092 in use, or not enough Docker memory. Read `docker compose logs kafka`. Use a 3.9.x tag. |
| App on the host can't connect to Kafka (`ECONNREFUSED` or timeouts) | Host apps use `KAFKA_BROKERS=localhost:9092`. Containers must use `kafka:19092`. Mixing them up is the usual cause. |
| `The group coordinator is not available` right after startup | The broker is still starting. kafkajs retries. If it persists, restart the consumer. |
| `This server does not host this topic-partition` or topic errors | Topics are missing. Set `KAFKA_AUTO_CREATE_TOPICS=true` locally, or create the topics in the managed console. |
| Consumer shows no activity and lag keeps growing | The `consumer` role isn't running (check `ROLES`), or the handler keeps failing. Check logs for `consumed` and error lines, and `check.results.dlq`. |
| Duplicate rows appear | Migration 5 not applied, or the code still inserts without `event_id` / `ON CONFLICT`. |
| Dashboard shows stale status | Cache entry not refreshed (consumer stopped), or the overlay isn't using `lastCheckedAt` from the cache. Check `redis-cli hgetall watcher:status:<id>`. |
| Everything is `degraded (Redis)` on Render | Wrong `REDIS_URL` (needs `rediss://` for TLS providers), or the free Render service can't reach the internal Redis URL. Try the external URL. |
| SASL auth errors on managed Kafka | Wrong mechanism (`plain` vs `scram-sha-256` or `scram-sha-512`), or `KAFKA_SSL` is not `true`. |
| `Producer ... idempotent` errors | Keep `maxInFlightRequests: 1` with `idempotent: true`. |
| Migrations hang on Neon | You are using the pooled URL for migrations. Set `DIRECT_DATABASE_URL`. |
| Render service gets suspended | Too much outbound traffic from a free service. Use intervals of 60 s or more and few monitors. |
| `docker compose up` migrates before Postgres is ready | The `migrate` service must depend on `db` with `condition: service_healthy`. |
| Two schedulers produce double checks | The Redis lock isn't applied, or the claim query isn't using `FOR UPDATE SKIP LOCKED`. Check both. |
