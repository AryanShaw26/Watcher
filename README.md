# Watcher

> Your APIs. Always in Sight.

![CI](https://github.com/AryanShaw26/Watcher/actions/workflows/ci.yml/badge.svg)

Watcher checks user-configured public HTTP(S) endpoints, records their status and latency, and displays incidents, alerts, and analytics in a dashboard. **Live demo:** not deployed yet.

## Features

- Scheduled HTTP checks with SSRF-safe outbound requests and a V1/V2-compatible results pipeline.
- Incident thresholds with hysteresis and transactional notification outbox records.
- Slack, Discord, and signed generic webhook alerts with retries, cooldown, and delivery history.
- Monitor uptime, response-time percentiles, and time-series analytics.
- OpenAPI documentation and Swagger UI at `/api/docs`.
- Encrypted notification targets and masked API responses.

## Version 3 architecture

```mermaid
flowchart LR
  U[Browser] --> W[Web: React SPA]
  W -->|/api| API
  subgraph Roles[Same codebase, independent roles]
    API[API]
    SCH[Scheduler]
    CON[Consumer]
    NOT[Notifier]
  end
  SCH -->|claim due monitors| PG[(Postgres)]
  SCH -->|per-monitor lock| R[(Redis)]
  SCH -->|publish| K[[Kafka or Redis Streams]]
  K --> CON
  CON -->|one transaction: result, incident, outbox| PG
  NOT -->|claim due notifications| PG
  NOT -->|cooldown and cap| R
  NOT -->|Slack, Discord, signed webhook| OUT[Notification channels]
  CON -->|status cache| R
  API --> PG
  API --> R
  API --> K
  DOCS[/api/docs/] --- API
```

The scheduler claims due monitors in Postgres, obtains a Redis lock, runs an SSRF-safe check, and publishes a versioned event. The consumer stores the result, updates monitor state, applies incident thresholds, and inserts any notification outbox rows in one Postgres transaction. The notifier claims due rows, applies cooldown and rate caps, sends the message, and records the outcome. Postgres remains authoritative; Redis is disposable coordination and cache state.

## Start the full stack

Requires Docker Desktop with Compose. From the repository root:

```powershell
docker compose up --build
```

The Compose configuration defines Postgres, Redis, Kafka in KRaft mode, one-time migrations, and the API, scheduler, consumer, notifier, and web containers. Full-stack startup has not yet been runtime-verified; see [the V3 verification report](./backend/report-v3.md) for current evidence. When running, stop with `Ctrl+C`; use `docker compose down` to stop without deleting database data.

To delete the local database and start fresh, use `docker compose down -v`. This permanently removes the local Postgres volume.

If another Postgres server is already using host port 5432, Compose can publish its database on 5433 instead. In PowerShell, set the override before starting Compose:

```powershell
$env:POSTGRES_HOST_PORT = "5433"
docker compose up --build
```

The containers continue to use `db:5432`. If connecting to the Compose database from a host-run backend, set its `DATABASE_URL` and `DIRECT_DATABASE_URL` to use `localhost:5433`.

## Run the web and API on the host

For iterative development, start only the infrastructure in Docker:

```powershell
docker compose up -d db redis kafka
Copy-Item backend\.env.example backend\.env
Copy-Item frontend\.env.example frontend\.env
```

Set `ENCRYPTION_KEY` in `backend\.env` to a new base64-encoded 32-byte key before starting the API:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Then in separate terminals:

```powershell
cd backend
npm ci
npm run migrate
npm run dev
```

```powershell
cd frontend
npm ci
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). To run roles independently, use `npm run dev:api`, `npm run dev:scheduler`, `npm run dev:consumer`, or `npm run dev:notifier` in separate backend terminals. The host-based example configuration connects to Kafka at `localhost:9092`; containers connect to `kafka:19092`.

## Roles and queue drivers

`ROLES` is a comma-separated selection of `api`, `scheduler`, `consumer`, and `notifier`. Local Compose runs them in separate containers. A deployment with limited services can run `ROLES=api,scheduler,consumer,notifier` in one process, with less failure isolation.

`QUEUE_DRIVER` selects:

- `kafka`: the default local broker and recommended production path when a managed Kafka service is configured.
- `redis-streams`: the alternate queue implementation, using Redis consumer groups.
- `memory`: unit-test-only; the application rejects it in production.

No production deployment or production queue provider is configured in this repository yet. Production must explicitly configure a managed Kafka service or select Redis Streams; local Compose and integration tests target Kafka.

## Design decisions

- **Transactional outbox:** incident state and notifications commit with the check result, avoiding a dual-write gap between Postgres and a message queue.
- **Thresholds and hysteresis:** an incident opens after consecutive failures and resolves after consecutive successes; single-check blips do not create outages.
- **Cooldown with visible suppression:** repeated alerts for a flapping monitor are marked suppressed in history instead of silently dropped.
- **Idempotency:** event IDs, a one-open-incident partial unique index, and a notification dedupe index prevent duplicate state and alerts.
- **Kafka behind a queue interface:** decouples check execution from result storage and allows independent consumers later. Redis Streams exercises that interface with a second real driver.
- **SQL claim plus Redis lock:** `FOR UPDATE SKIP LOCKED` decides which monitors are due; the TTL lock prevents overlapping execution for the same monitor if a check runs long or another trigger overlaps.
- **Redis is disposable, not authoritative:** it holds locks, shared rate limits, pipeline metadata, and a status cache. Postgres remains the source of truth, so cache loss falls back to Postgres.
- **At-least-once delivery, effectively-once storage:** a queue can redeliver. A unique `event_id` and `ON CONFLICT DO NOTHING` prevent a duplicate result row. Events are keyed by monitor ID for partition ordering; late events enter history but cannot overwrite newer monitor status.
- **Synchronous manual-check path:** manual checks return their new result immediately and write to Postgres/cache directly. Scheduled checks use the queue.
- **Publish fallback:** if queue publishing fails and `QUEUE_FALLBACK_TO_DB=true`, the scheduler stores that event directly with the same idempotency key.
- **Secrets and outbound SSRF:** channel targets are encrypted at rest and masked in responses. Each outbound target is checked against private-address and DNS-rebinding risks; Slack and Discord are restricted to official hosts. Generic webhook payloads are signed.
- **Analytics:** percentiles use successful checks with response times only. Incident duration begins at threshold confirmation, so it can overstate the actual outage by up to `recovery_threshold - 1` check intervals.

## Failure behavior

| Failure | Behavior |
|---|---|
| Consumer stopped | The queue retains events; lag grows. Restarting the consumer resumes processing. |
| Redis unavailable | Status reads fall back to Postgres; lock acquisition fails open; status-cache writes are skipped; rate limiting fails open. Health and Pipeline report degraded. |
| Kafka unavailable | Scheduled checks are stored directly when queue fallback is enabled. Publishing resumes when Kafka recovers. |
| Result write fails | Consumer retries with exponential backoff, then publishes to the dead-letter destination. If dead-letter publishing also fails, it does not acknowledge the message. |
| Notifier stops | Pending notifications remain in Postgres and are reclaimed after the sending lock expires when the notifier restarts. |
| Webhook delivery fails | Transient errors retry with backoff; permanent errors fail without retry. Cooldown and hourly-cap suppressions remain visible in history. |
| Duplicate event | The unique event ID makes the write a no-op. |
| Older event arrives late | It is retained in history but does not replace newer monitor state. |
| Render sleeps | In-process roles pause while the free service sleeps; checks and alerts resume when it wakes. |

Fail-open locking and rate limiting prioritize availability during Redis outages. Rate limiting is therefore weaker while Redis is unavailable; this is a deliberate V2 trade-off.

## Configuration and security

Copy [backend/.env.example](./backend/.env.example) to `backend/.env` for host development. Compose supplies service-specific variables directly. Never commit `.env` files.

The API uses rotating httpOnly refresh cookies and memory-only access tokens. Monitor and channel queries are owner-scoped. User-supplied monitor and webhook URLs are checked at creation and connection time to reduce SSRF and DNS-rebinding risk. Private destinations are blocked by default. Notification targets use AES-256-GCM encryption at rest; generic webhook payloads have an HMAC-SHA-256 signature with timestamp validation.

## Testing

```powershell
cd backend
npm test
```

Runs unit tests with the in-memory queue and rate-limit store; it does not require Redis or Kafka. The two test commands are `npm test` (unit tests) and `npm run test:integration` (real infrastructure integration tests):

```powershell
npm run test:integration
```

Integration tests require the `watcher_test` database to exist and be migrated, plus Redis and Kafka available at the URLs in the backend environment. Create `watcher_test` once using your local Postgres administrator; never substitute a database containing data you need to keep. The preflight fails loudly when a required service is unreachable; it does not skip tests. To prepare only the test database, from `backend` in PowerShell:

```powershell
$testDbUrl = "postgres://watcher:watcher@localhost:5432/watcher_test"
$env:DATABASE_URL = $testDbUrl
$env:DIRECT_DATABASE_URL = $testDbUrl
npm run migrate
npm run test:integration
Remove-Item Env:DATABASE_URL, Env:DIRECT_DATABASE_URL
```

Do not point these test commands at a database containing data you need to keep. The full operational acceptance scenarios (catch-up, outages, scaling scheduler instances, and browser behavior) require Docker Compose.

## Known limitations

- The application has not been deployed; production URLs and managed Redis/Kafka credentials are not configured. No live demo or screenshots are available yet.
- Render's free service sleeps when idle, pausing in-process roles until it wakes.
- Running all roles in one production process removes the isolation available in local Compose.
- Rate limiting fails open if Redis is down.
- Raw check history is retained for eight days; long-term rollups are not implemented.
- Email alerts and API keys are not implemented.
- The V1 product limitations still apply: no status pages, maintenance windows, custom check headers/bodies, or multi-region checks.

## Roadmap

- Complete local Docker and end-to-end verification, run CI on a pull request, and deploy a live demo.
- Add responsive and keyboard-accessibility review, screenshots, and long-term analytics rollups.
