# Watcher V2 fix report

## 1. Verdict
**PARTIALLY VERIFIED**

Backend builds, lint, typecheck, unit tests, Postgres-only integration tests, migration scenarios, and dependency audits passed. The frontend builds, typechecks, lints, and its production bundle is split. Redis, Kafka, and Docker were unavailable, so broker-dependent integration tests and runtime scenarios R1–R13 remain blocked; do not tag V2 until the Human verification checklist passes.

## 2. Summary table
| Task | Title | Status | One-line result |
|---|---|---|---|
| F1 | Lint | FIXED-VERIFIED | Flat ESLint configs and typecheck scripts; backend and frontend lint/typecheck pass. |
| F2 | Integration tests never skip | FIXED-VERIFIED | Preflight exits non-zero and names unreachable Redis/Kafka; Vitest does not start. |
| F3 | Migration script | FIXED-VERIFIED | Hardened adoption/refusal logic and migration 5 verified across S1–S6 scratch scenarios. |
| F4 | Test gap | FIXED-VERIFIED | Unit suite is 30 passed, 0 failed, 0 skipped; 8 Postgres-only integration tests passed; Redis/Kafka cases are documented as blocked. |
| F5 | Core logic audit | FIXED-VERIFIED | Fixed best-effort cache/retry failures and bounded reverse-order shutdown; remaining audited items pass static review and targeted tests. |
| F6 | Runtime verification | BLOCKED | Docker CLI/daemon, Redis, and Kafka are unavailable; no runtime behavior was simulated. |
| F7 | Docker artifacts | STATIC-ONLY | Compose, Dockerfiles, and nginx configuration reviewed; `docker compose config` could not run. |
| F8 | Frontend | FIXED-VERIFIED | Pipeline states/copy and lazy detail route implemented; build, lint, typecheck, and local login-page smoke check pass. |
| F9 | Security regression | FIXED-VERIFIED | Production guards/warning tested; backend and frontend production dependency audits report zero vulnerabilities. |
| F10 | README accuracy | FIXED-VERIFIED | Start/test commands, port workaround, deployment status, and limitations documented; Docker runtime limitation disclosed. |

## 3. Environment

- OS/shell: Windows, Windows PowerShell 5.1.26100.9818.
- Node.js: `v24.14.0`; npm: `11.9.0`; Git: `2.51.1.windows.1`.
- Docker: CLI unavailable in PATH (`docker` was not recognized); daemon reachability and Compose version/configuration therefore could not be checked.
- Postgres: reachable, version 18.4, port 5432.
- Redis: `localhost:6379` refused connections (`ECONNREFUSED`).
- Kafka: `localhost:9092` unavailable (KafkaJS connection error).
- Databases used: `watcher_test` for tests; `watcher_fix_baseline`, `watcher_fix_s1`, `watcher_fix_s2`, `watcher_fix_s3`, `watcher_fix_s4`, and `watcher_fix_s6` for migration work. The developer's `watcher` database was not reset, dropped, or used for destructive experiments.
- Scratch databases were retained. No temporary migration file remains. No temporary Compose port mapping or persistent environment setting was made; Compose now supports the documented `POSTGRES_HOST_PORT` override. The local frontend preview process was stopped.
- No V2 tag was created.

## 4. Baseline vs final
| Check | Baseline | Final |
|---|---|---|
| backend build | Passed, exit 0 | `npm run build`: passed, exit 0; `npm run typecheck`: passed, exit 0 |
| backend lint | Failed: ESLint 10 found no flat config | `npm run lint`: passed, exit 0 |
| backend unit tests (passed / failed / skipped) | 12 / 0 / 0 | 30 / 0 / 0 |
| backend integration tests (passed / failed / skipped, or reason not run) | 1 / 7 / 0; Redis/Kafka-dependent cases failed because services were unavailable | `npm run test:integration`: preflight exit 1, Vitest not started (0 / 0 / 0); separate Postgres-only run: 8 / 0 / 0 |
| frontend build (include main chunk size) | Passed; main JS chunk 794.29 KB | Passed; main JS 367.04 KB (117.59 KB gzip), lazy `MonitorDetail` chunk 428.83 KB (120.66 KB gzip) |
| frontend lint | Passed with two existing Fast Refresh warnings | Passed with the same two warnings in `StatusBadge.tsx` and `AuthContext.tsx` |

## 5. Task details

### F1. Lint: FIXED-VERIFIED
- **Problem found:** ESLint 10 had no flat configuration; neither package exposed the required typecheck command.
- **What I changed:** Added backend/frontend ESLint flat configs and typecheck scripts, updated lint dependencies/lockfiles, and corrected behavior-neutral lint findings. Backend TypeScript is pinned to `~6.0.3` to satisfy the installed type-aware ESLint peer range.
- **Evidence:** `cd backend; npm run build; npm run lint; npm run typecheck` and equivalent frontend commands all exited 0 in final checks. Frontend oxlint reports two Fast Refresh warnings, but no errors.
- **Remaining issues:** The two frontend Fast Refresh warnings are unchanged and non-fatal.

### F2. Integration tests never skip: FIXED-VERIFIED
- **Problem found:** Integration tests could previously run green-looking when external infrastructure was absent.
- **What I changed:** Added `backend/scripts/check-infra.mjs` and a separate `backend/vitest.integration.config.ts`; `npm run test:integration` now checks Postgres (`watcher_test`), Redis, and Kafka before starting Vitest.
- **Evidence:** `cd backend; npm run test:integration` exited 1 and printed:
  ```text
  Kafka unavailable: Connection error:
  Redis unavailable: ECONNREFUSED
  Postgres (watcher_test): reachable
  Integration tests were not started; required infrastructure is unavailable.
  ```
  No Vitest process was started. The preflight does not silently skip tests.
- **Remaining issues:** A successful full integration run requires reachable Redis and Kafka; see F6 and the Human checklist.

### F3. Migration script: FIXED-VERIFIED
- **Problem found:** Adopting hand-created V1 tables without an exact schema check could record an incorrect migration baseline.
- **What I changed:** Hardened `backend/scripts/migrate.mjs` to use `DIRECT_DATABASE_URL` when set, warn on pooler URLs, report failures, compare a V1 schema snapshot before adoption, and refuse an untracked `event_id`. Added migration `1700000000005_add-check-result-event-id.sql`.
- **Evidence:** S1–S6 below were performed on `watcher_fix_*` databases. Read-only follow-up confirmed S1/S2/S6 have five history rows and all expected tables; S2 still has one user and one monitor. S3 has zero history rows and still lacks `monitors.last_error`; S4 has zero history rows and still has the deliberately untracked `event_id`. Migration 5 up/down was exercised on scratch data.
- **Remaining issues:** None for the required scratch scenarios. Do not point migration experiments at `watcher`.

### F4. Test gap: FIXED-VERIFIED
- **Problem found:** The baseline suite had 12 unit tests and did not inventory the V2 behaviors required by PRD-v2 §15.
- **What I changed:** Added/expanded tests for the event schema, memory queue, consumer retry/DLQ behavior, fallback behavior, production memory-store guards, unknown roles, production private-target warning, Postgres result transitions, auth, monitor ownership, status fallback, Redis outage behavior, and broker queue contracts. The Redis/Kafka contract tests now explicitly cover redelivery after handler failure and close behavior, but cannot be run here.
- **Evidence:** Final `npm test`: 8 files passed, 30 tests passed, 0 failed, 0 skipped. Postgres-only integration command, using the configured database URL with only the database name changed to `watcher_test`: 5 files passed, 8 tests passed, 0 failed, 0 skipped. It covered result state, ownership, auth, API DB fallback, and Redis-disconnected status reads.
- **Remaining issues:** Redis round-trip/lock tests, cache-hit API overlay, and Kafka/Redis Streams integration contracts require infrastructure not available here. One initial manual integration attempt used the sample `watcher` password against this host's Postgres; it failed authentication (28P01) and Vitest auto-skipped setup-dependent cases. It was corrected to use the repository-configured credentials with only the database name changed; the successful rerun had 0 skips. No tests were skipped, weakened, or deleted to obtain that successful run.

### F5. Core logic audit: FIXED-VERIFIED
- **Problem found:** Retry-delay/cache failures could escape the consumer's “DLQ publish is the only throw” contract; a cache refresh failure after a successful DB fallback could report a stored result as lost. Shutdown used separate waits rather than one shared deadline and did not start roles in the order needed for reverse-order shutdown.
- **What I changed:** Made cache/timestamp writes and retry delay best-effort in `handleMessage`; preserved a successful fallback when cache refresh fails; added a common shutdown deadline with explicit timeouts/errors; start order is consumer → scheduler → API and stop order is API → scheduler → queue/consumer → Redis → Postgres. Added targeted regression tests.
- **Evidence:** Backend build, lint, typecheck, and 30 unit tests passed. Postgres-only integration tests passed 8/8. Source audit citations are in the checklist below.
- **Remaining issues:** Real Redis/Kafka behavior remains unverified because those services are unavailable; see F6. No remaining static PRD mismatch was found.

#### F5 core checklist

**`src/consumer/handleMessage.ts` (PRD-v2 §7)**
- **PASS** Poison JSON/schema/version failures publish to DLQ with `attempts: 0`, then return: `backend/src/consumer/handleMessage.ts:36`, `:38`.
- **PASS** Retries are bounded by `CONSUMER_MAX_ATTEMPTS`; exponential `base * 4^(attempt-1)` delay is injectable: `backend/src/consumer/handleMessage.ts:43`, `:68`.
- **PASS** Final failure publishes `{ error, attempts }`, logs at error level, then returns/acknowledges: `backend/src/consumer/handleMessage.ts:72`, `:73`.
- **FIXED** The handler now absorbs cache, timestamp, and injected delay failures; the only propagated failure is a failed DLQ publish: `backend/src/consumer/handleMessage.ts:30`, `:50`, `:68`, `:72`; regression tests at `backend/src/consumer/handleMessage.test.ts:44`, `:98`.
- **PASS** Duplicate, FK `23503`, and out-of-order results are non-errors: `backend/src/consumer/handleMessage.ts:47`, `:62`, `:65`.
- **PASS** Cache status is written only for an applied result; processed timestamp and the common consumed log are emitted after processing: `backend/src/consumer/handleMessage.ts:49`, `:54`, `:56`.
- **PASS** Logs contain event/monitor metadata and errors, not message values or full event payloads: `backend/src/consumer/handleMessage.ts:56`, `:73`.

**`src/modules/results/result.service.ts` (PRD-v2 §9.2)**
- **PASS** One transaction and `INSERT ... ON CONFLICT (event_id) DO NOTHING RETURNING id`: `backend/src/modules/results/result.service.ts:18`, `:23`.
- **PASS** Duplicate returns `{ inserted: false, applied: false, previousStatus: null }` before monitor access: `backend/src/modules/results/result.service.ts:24`.
- **PASS** Current status is read with `SELECT ... FOR UPDATE`: `backend/src/modules/results/result.service.ts:29`.
- **PASS** State update is guarded by `last_checked_at IS NULL OR last_checked_at <= $checkedAt`: `backend/src/modules/results/result.service.ts:40`.
- **PASS** Failure counter uses the required `CASE` expression: `backend/src/modules/results/result.service.ts:38`.
- **PASS** FK errors are not swallowed by `recordResult`; the consumer handles `23503`: `backend/src/modules/results/result.service.ts:18`, `backend/src/consumer/handleMessage.ts:62`.
- **PASS** Manual check and publish fallback use the event-based signature: `backend/src/modules/monitors/monitor.routes.ts:89`, `backend/src/scheduler/publish.ts:43`.

**`src/scheduler/scheduler.ts` and `publish.ts` (PRD-v2 §8)**
- **PASS** Atomic claim still uses `FOR UPDATE SKIP LOCKED` and `RETURNING *`: `backend/src/scheduler/scheduler.ts:17`, `:24`.
- **PASS** Lock key and timeout include the configured buffer; held locks skip quietly and release occurs in `finally`: `backend/src/scheduler/scheduler.ts:34`, `:35`, `:37`, `:54`.
- **PASS** `running` prevents overlapping ticks; each monitor error is isolated: `backend/src/scheduler/scheduler.ts:60`, `:65`, `:68`.
- **PASS** Queue publish falls back to `recordResult`, caches applied state, reports fallback/lost paths: `backend/src/scheduler/publish.ts:17`, `:43`, `:46`.
- **PASS** `PUBLISH_TIMEOUT_MS` bounds queue publish wait: `backend/src/scheduler/publish.ts:24`, `:30`.
- **PASS** Retention is started only with the scheduler role: `backend/src/roles.ts:35`, `:36`.

**`src/redis/*.ts` (PRD-v2 §5)**
- **PASS** Lock is `SET NX PX` with a random token and Lua compare-delete; Redis outage logs and fails open: `backend/src/redis/lock.ts:15`, `:24`.
- **PASS** Status read/write/delete and pipeline timestamp paths warn and swallow Redis errors: `backend/src/redis/statusCache.ts:46`, `:68`, `:74`, `:79`, `:84`.
- **PASS** Status, lock, stream, rate-limit, and pipeline keys use `REDIS_KEY_PREFIX`: `backend/src/redis/client.ts:27`, `backend/src/redis/statusCache.ts:36`, `backend/src/middleware/rateLimit.ts:19`.
- **PASS** Redis URL is not logged; the shared client logs only the Redis error message: `backend/src/redis/client.ts:5`, `:15`.
- **PASS** RedisStore is selected only for `RATE_LIMIT_STORE=redis`, with `passOnStoreError: true`: `backend/src/middleware/rateLimit.ts:16`, `:18`.

**Queue drivers (PRD-v2 §6)**
- **PASS** `QueueMessage`/`ResultQueue` match the declared shape: `backend/src/queue/types.ts:3`, `:9`.
- **PASS** Kafka producer is idempotent, limits in-flight requests to one, sends `acks: -1`, keys by monitor, and sends the required DLQ headers: `backend/src/queue/kafka.queue.ts:53`, `:81`, `:120`.
- **PASS** Kafka topic setup and consumer group configuration follow env; stats are cached and failures return disconnected/null stats: `backend/src/queue/kafka.queue.ts:61`, `:95`, `:136`, `:159`.
- **PASS** Redis Streams uses approximate max length, a consumer group, blocking connection, ACK after handler success, pending recovery, DLQ stream, and guarded stats: `backend/src/queue/redisStreams.queue.ts:26`, `:51`, `:60`, `:83`, `:97`, `:105`.
- **PASS** Memory queue rejects production use: `backend/src/queue/memory.queue.ts:15`.

**Config, roles, API (PRD-v2 §3.2, §10, §12)**
- **PASS** Unknown/empty roles are rejected; configuration checks Redis, Kafka, and production memory restrictions: `backend/src/config/env.ts:53`, `:55`, `:57`, `:60`, `:63`, `:66`.
- **FIXED** Roles start in consumer/scheduler/API order and share a 10-second shutdown deadline; server, scheduler, queue/consumer, Redis, and Postgres are closed in reverse order: `backend/src/roles.ts:29`, `:32`, `:35`, `:39`, `:45`, `:49`, `:60`, `:67`, `:68`, `:70`, `:71`. Deadline helper and tests: `backend/src/lib/gracefulShutdown.ts:6`, `backend/src/lib/gracefulShutdown.test.ts:4`.
- **PASS** Boot validation and production `ALLOW_PRIVATE_TARGETS=true` warning are implemented: `backend/src/config/env.ts:53`, `:73`.
- **PASS** Health checks Postgres first; only Postgres failure returns 503, otherwise Redis/queue state is represented in a 200 response: `backend/src/app.ts:34`, `:36`, `:41`, `:46`.
- **PASS** Pipeline route is auth-protected; response is cached five seconds and follows the state/reason rules: `backend/src/modules/system/system.routes.ts:8`, `backend/src/modules/system/pipeline.service.ts:17`, `:19`, `:23`, `:24`, `:31`.
- **PASS** Monitor list/detail overlay cache values with DB fallback; delete removes status cache: `backend/src/modules/monitors/monitor.service.ts:36`, `:44`, `:52`, `:57`, `:92`, `:94`.
- **PASS** All monitor routes require auth; event schema is strict: `backend/src/modules/monitors/monitor.routes.ts:17`, `backend/src/queue/event.ts:5`, `:15`.

**V1 regressions**
- **PASS** SSRF tests and auth integration tests passed: `backend/src/lib/ssrf.test.ts:5`, `backend/tests/integration/auth.test.ts:25`, `:45`.
- **PASS** Ownership scoping across monitor routes passed on Postgres: `backend/tests/integration/monitorOwnership.test.ts:41`.

### F6. Runtime verification: BLOCKED
- **Problem found:** None that can be established without the runtime services; environment is missing Docker, Redis, and Kafka.
- **What I changed:** No pipeline behavior was simulated. Added real broker contract tests for the developer to run when infrastructure is available.
- **Evidence:** Docker CLI unavailable; final integration preflight found Postgres reachable but Redis refused connections and Kafka unavailable.
- **Remaining issues:** All scenarios R1–R13 are blocked. No runtime “healthy” state, broker recovery, catch-up, outage, scale, or full-stack result is claimed.

### F7. Docker artifacts: STATIC-ONLY
- **Problem found:** V2 needed Compose services and a production frontend container; the default DB host mapping conflicts when local Postgres already owns port 5432.
- **What I changed:** Added Compose host-port override `POSTGRES_HOST_PORT`, web Dockerfile/nginx config, and frontend `.dockerignore`. README explains the 5433 workaround.
- **Evidence:** Static review: backend Dockerfile is multi-stage, uses non-root `node`, installs production dependencies, and copies `dist/`, `migrations/`, and migration scripts. Compose defines health checks for DB/Redis/Kafka, migration completion dependencies, separate roles, Kafka 3.9.1 dual listeners, and no `container_name`. Frontend uses Node build + nginx, `/api/` proxy, SPA fallback, and ignores `node_modules`, `.env`, `dist`.
- **Remaining issues:** `docker compose config`, image build, health checks, and startup were not run because Docker CLI/daemon are unavailable. Compose includes development-only credentials; no credentials are baked into Dockerfiles.

### F8. Frontend: FIXED-VERIFIED
- **Problem found:** The Pipeline card needed accurate pending/error states and exact copy; the initial JavaScript bundle was about 794 KB.
- **What I changed:** Pipeline card now distinguishes loading from request failure, uses the specified copy/orb states and en dash for unknown counts, polls every 10 seconds, and labels state text beside the orb. The monitor detail route and chart library are lazy-loaded with `React.lazy`/`Suspense`.
- **Evidence:** `npm run typecheck`, `npm run lint`, and `npm run build` passed. Final chunks: main 367.04 KB, detail 428.83 KB. Local production preview opened at `/login` with the expected title/form; its API request returned 502 because no backend was running, so authenticated dashboard/pipeline behavior was not verified in-browser. Used colors are documented in `docs/design.md`; no `localStorage`/`sessionStorage` use was found.
- **Remaining issues:** Full dashboard/pipeline interaction still needs a running API and infrastructure. Two existing Fast Refresh lint warnings remain.

### F9. Security regression: FIXED-VERIFIED
- **Problem found:** Required production guard/warning and dependency audit checks needed explicit evidence.
- **What I changed:** Added a test proving production logs the `ALLOW_PRIVATE_TARGETS=true` warning. Reviewed logger/configuration uses for secrets, tokens, cookies, Redis URLs, and Kafka SASL values.
- **Evidence:** `npm test` includes passing cases for both production memory guards, invalid `ROLES`, and the private-target warning. `npm audit --omit=dev --audit-level=high` in backend and frontend each exited 0 with `found 0 vulnerabilities`. `backend/src/lib/logger.ts:6` redacts authorization, cookies, set-cookie, and password fields. Search found credentials only used to configure clients, not logged as fields.
- **Remaining issues:** Broker and full-stack security behavior remains subject to the blocked runtime checklist. An initial version of the new warning test inherited the unit suite's memory settings and failed; the test was corrected to explicitly select valid production Kafka/Redis settings, and the final full unit run passed.

### F10. README accuracy: FIXED-VERIFIED
- **Problem found:** README needed the actual V2 start/test workflows, deployment status, limitations, and a safe DB-port workaround.
- **What I changed:** Documented one-command Compose start, host workflow, queue/role design, tests and `watcher_test` safety, `POSTGRES_HOST_PORT=5433`, production-not-deployed status, Render sleep/single-process limitations, Redis cache behavior, and the Docker verification caveat.
- **Evidence:** Static review against package scripts, Compose/Docker configuration, environment examples, and test preflight. Documentation-only change; Docker runtime intentionally not claimed as verified.
- **Remaining issues:** The Compose instructions require the developer checklist because Docker was unavailable here.

## 6. Test inventory

Summary: 30 unit tests passed with 0 skipped; 8 Postgres-only integration tests passed with 0 skipped; Redis/Kafka-dependent tests are present and explicitly BLOCKED pending those services. The final `npm run test:integration` preflight exited before launching Vitest, so it did not report a misleading green or skipped suite.

| PRD-v2 §15 item | Test file and test name | Status |
|---|---|---|
| 1a | `tests/integration/resultState.test.ts` — `inserts a duplicate event ID only once` | VERIFIED on Postgres |
| 1b | `tests/integration/resultState.test.ts` — `stores an older event without overwriting newer monitor state` | VERIFIED on Postgres |
| 1c | `tests/integration/resultState.test.ts` — `increments consecutive failures on down and resets them on up` | VERIFIED on Postgres |
| 1d | `tests/integration/resultState.test.ts` — the three state-transition tests assert `previousStatus` (`pending`/`down`) and the duplicate's `null` | VERIFIED on Postgres |
| 2a | `src/consumer/handleMessage.test.ts` — `sends invalid JSON to DLQ without retrying` | VERIFIED |
| 2b | `src/consumer/handleMessage.test.ts` — `retries transient storage failures and acknowledges after success` | VERIFIED |
| 2c | `src/consumer/handleMessage.test.ts` — `sends the final failure to DLQ after the configured attempts` | VERIFIED |
| 2d | `src/consumer/handleMessage.test.ts` — `acknowledges a deleted monitor without retrying or sending to the DLQ` | VERIFIED |
| 2e | `src/consumer/handleMessage.test.ts` — `throws only when publishing the DLQ fails`; also `throws on a final processing failure only when the DLQ publish fails` | VERIFIED |
| 3 | `src/queue/event.test.ts` — `accepts a valid event`, `rejects unknown fields`, `rejects unsupported version and malformed ids` | VERIFIED; includes bad event and monitor UUIDs |
| 4a | `src/scheduler/publish.test.ts` — `stores the event through DB fallback when enabled` | VERIFIED |
| 4b | `src/scheduler/publish.test.ts` — `reports the lost path when fallback is disabled` | VERIFIED |
| 5a | `tests/integration/lock.test.ts` — `prevents a second holder and only releases with the matching token` | BLOCKED: Redis unavailable |
| 5b | `tests/integration/lock.test.ts` — same test, wrong-token assertion | BLOCKED: Redis unavailable |
| 5c | `tests/integration/lock.test.ts` — `expires after its TTL` | BLOCKED: Redis unavailable |
| 6a | `tests/integration/statusCache.test.ts` — `round-trips values and maps empty fields to null` | BLOCKED: Redis unavailable |
| 6b | `tests/integration/statusCacheUnavailable.test.ts` — `returns an empty map without throwing when the Redis connection is unavailable` | VERIFIED |
| 7 | Memory: `src/queue/queue.contract.test.ts` — delivery, failed-handler retry, DLQ stats, and close. Broker drivers: `tests/integration/queue.contract.test.ts` — delivery/DLQ, redelivery after rejection, and stop-after-close | Memory VERIFIED; Kafka/Redis Streams BLOCKED: both services unavailable |
| 8 | Cache hit: `tests/integration/recordResult.test.ts` — `serves a cached status overlay through the authenticated monitor API`; DB fallback: `tests/integration/monitorApiFallback.test.ts` — `uses the database status columns when no cached status exists` | DB fallback VERIFIED; cache-hit case BLOCKED: Redis unavailable |
| Production queue memory guard | `src/config/env.test.ts` — `refuses production memory configuration for QUEUE_DRIVER` | VERIFIED |
| Production rate-limit memory guard | `src/config/env.test.ts` — `refuses production memory configuration for RATE_LIMIT_STORE` | VERIFIED |
| Invalid `ROLES` | `src/config/env.test.ts` — `rejects unknown roles` | VERIFIED |
| Production private-target warning | `src/config/env.test.ts` — `warns when private targets are allowed in production` | VERIFIED |

## 7. Migration scenarios

All migration experiments targeted scratch databases. `npm run migrate` selected the scratch URL through `DATABASE_URL`/`DIRECT_DATABASE_URL`; connection credentials are intentionally omitted.

| ID | Starting state | Command and trimmed result | Status |
|---|---|---|---|
| S1 | Empty `watcher_fix_s1` | `npm run migrate`; applied migrations 1–5 (`create-users`, `create-refresh-tokens`, `create-monitors`, `create-check-results`, `add-check-result-event-id`); five history rows and expected tables. Second run printed `No migrations to run!`. | VERIFIED |
| S2 | Hand-created exact V1 tables, empty history; one sample user and monitor inserted | `npm run migrate`; exact V1 baseline adopted, migration 5 applied. Read-only check afterward: five history rows, one user, one monitor, and all expected tables. | VERIFIED |
| S3 | V1 tables missing `monitors.last_error` | `npm run migrate`; non-zero refusal named missing `monitors.last_error`; zero history rows; deliberate schema mismatch remained unchanged. | VERIFIED |
| S4 | V1 tables plus untracked `check_results.event_id`, no migration history | `npm run migrate`; non-zero refusal; zero history rows; the preexisting column remained unchanged. | VERIFIED |
| S5 | Fully migrated scratch DB | `npm run migrate`; printed `No migrations to run!`, exit 0. | VERIFIED |
| S6 | Fully migrated scratch DB plus temporary SQL-error migration | `npm run migrate`; non-zero SQL failure; history remained at five rows, probe table absent, existing data intact. Temporary migration file removed. | VERIFIED |

Migration 5 was verified as `event_id uuid NOT NULL DEFAULT gen_random_uuid()` with `check_results_event_id_uq`. Its down migration removed the event column/constraint while retaining V1 tables; migration was reapplied afterward.

## 8. Runtime scenarios

Docker was unavailable; Redis and Kafka were unreachable. Per `fixed.md`, no substitutes or mocks were used for runtime scenarios.

| ID | Result | Missing evidence / reason |
|---|---|---|
| R1 | BLOCKED | Docker CLI/daemon unavailable; Compose services could not start or become healthy. |
| R2 | BLOCKED | No full stack to add a monitor and compare scheduler/consumer event IDs. |
| R3 | BLOCKED | Kafka and Docker unavailable. |
| R4 | BLOCKED | Kafka and Docker unavailable. |
| R5 | BLOCKED | Kafka/Docker unavailable; no consumer stop/restart or lag/data counts. |
| R6 | BLOCKED | No running broker/consumer for real replay; duplicate DB behavior is covered only by Postgres integration tests. |
| R7 | BLOCKED | Kafka/Docker unavailable; no real poison-message DLQ or pipeline response. |
| R8 | BLOCKED | Redis/Docker unavailable; no outage/recovery or live health/pipeline response. |
| R9 | BLOCKED | Kafka/Docker unavailable; no fallback/recovery runtime observation. |
| R10 | BLOCKED | Docker unavailable; no two-scheduler 10-minute run. |
| R11 | BLOCKED | Redis unavailable; no Redis Streams driver run. |
| R12 | BLOCKED | Redis/Docker unavailable; rate-limit persistence across API restart not checked. |
| R13 | BLOCKED | Docker unavailable; no clean full-stack build/register/monitor/browser scenario. |

## 9. Changes made

Commits on `v2-fixes` (all include the required Copilot co-author trailer):

- `57fd27b` — `fix(F1): configure ESLint flat configs` — backend/frontend lint configs, package manifests/locks, and lint fixes in auth, monitor, queue, scheduler, and app code.
- `e7c3572` — `fix(F2): require integration infrastructure preflight` — `backend/scripts/check-infra.mjs`, backend package scripts.
- `d8ca24b` — `fix(F3): validate legacy schema before migration baseline` — `backend/scripts/migrate.mjs`.
- `225fa92` — `fix(F4): cover pipeline failures and state transitions` — consumer/publish tests and behavior, environment tests, Postgres integration tests, and preflight safety.
- `d49c03b` — `fix(F3): include event id migration` — migration 5 SQL file.
- `7b24650` — `fix(F2): isolate integration test pattern` — integration Vitest config.
- `41a1c90` — `fix(F4): cover event schema and memory queue` — event/memory queue tests and unit test environment setup.
- `325f4b8` — `fix(F5): harden pipeline retries and shutdown` — core V2 API/config, consumer, queue drivers, Redis, result/scheduler logic, roles/shutdown, replay script, and regression tests.
- `4a95320` — `fix(F7): add V2 Compose and web container` — Compose, frontend Dockerfile, nginx config, and `.dockerignore`.
- `ae52aa8` — `fix(F8): split monitor detail and pipeline UI` — lazy route, monitor detail/form/top bar, API and Pipeline card, CSS.
- `77bf834` — `fix(F9): test production private target warning` — `backend/src/config/env.test.ts`.
- `e584a2c` — `fix(F4): complete broker queue contract tests` — integration queue contract tests, malformed UUID assertion, integration timeout.
- `5eefdc8` — `fix(F10): document V2 operation and verification` — README, backend environment example, V2 PRD and implementation docs.

`report.md` is the final deliverable and is committed separately after the final checks.

## 10. Open issues

- **BLOCKED — R1–R13:** Docker, Redis, and Kafka runtime scenarios remain to be run. Use the exact commands below; do not tag V2 until these pass.
- **BLOCKED — real broker integration:** Redis lock/cache round-trip, cache-hit monitor overlay, and Kafka/Redis Streams queue contracts were not executable here.
- **BLOCKED — Compose validation:** `docker compose config`, image builds, and health checks were not run because the Docker CLI is absent.
- **NOT VERIFIED — authenticated browser behavior:** Static production preview reached the login page, but the API returned 502; dashboard and Pipeline card need the complete stack.
- No unresolved code/test failure remains in the checks that could be run. The failed intermediate integration attempt was an incorrect credential override, not a code failure; the corrected Postgres-only run passed 8/8.

## 11. Human verification checklist

Run from the repository root in PowerShell. Integration tests use only the isolated `watcher_test` database derived from `backend/.env`, never the developer's `watcher` database. Compose's database is for runtime scenarios.

```powershell
# 1) Infrastructure; publish Compose Postgres on 5433 if host port 5432 is occupied.
$env:POSTGRES_HOST_PORT = "5433"
docker compose up -d db redis kafka
docker compose ps
# Expected: db, redis, and kafka become healthy.

# 2) Create watcher_test if needed using the existing backend/.env connection.
# This touches only the test database; if the role cannot CREATE DATABASE,
# create watcher_test via pgAdmin instead. Never use the developer's watcher DB.
Push-Location backend
node --input-type=module -e "import 'dotenv/config'; import pg from 'pg'; const url = new URL(process.env.DATABASE_URL); url.pathname = '/postgres'; const client = new pg.Client({ connectionString: url.toString() }); try { await client.connect(); const result = await client.query('SELECT 1 FROM pg_database WHERE datname=$1', ['watcher_test']); if (!result.rowCount) await client.query('CREATE DATABASE watcher_test'); } finally { await client.end(); }"
# Derive the test URL without printing its credentials.
$env:DATABASE_URL = node --input-type=module -e "import 'dotenv/config'; const url = new URL(process.env.DATABASE_URL); url.pathname = '/watcher_test'; process.stdout.write(url.toString())"
$env:DIRECT_DATABASE_URL = $env:DATABASE_URL
npm run migrate
npm test
npm run test:integration
Pop-Location
# Expected: migration output or "No migrations to run!", unit suite 0 skipped,
# and full integration suite 0 skipped with Redis/Kafka reachable.

# 3) Full stack and matching published/consumed event ID.
docker compose up --build -d
# Open http://localhost:3000, register, and add https://example.com.
# Expected: scheduler "published" and consumer "consumed" logs share eventId.
docker compose logs --tail 100 scheduler consumer

# 4) Kafka contents and consumer lag.
docker compose exec kafka /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic check.results --from-beginning --max-messages 3
docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group watcher-result-writers
# Expected: event values are visible and consumer lag returns to 0.

# 5) Catch-up: stop the consumer for at least 3 checks, compare lag and DB rows,
# restart it, then confirm lag returns to 0 and result rows appear.
docker compose stop consumer
docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group watcher-result-writers
docker compose exec -T db psql -U watcher -d watcher -c "SELECT count(*) FROM check_results WHERE checked_at > now() - interval '10 minutes'"
docker compose start consumer
docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group watcher-result-writers
docker compose exec -T db psql -U watcher -d watcher -c "SELECT count(*) FROM check_results WHERE checked_at > now() - interval '10 minutes'"

# 6) Idempotency: replace the example values with an existing event/monitor UUID.
Push-Location backend
npm run event:replay -- "PASTE_EVENT_UUID" "PASTE_MONITOR_UUID"
Pop-Location
docker compose exec -T db psql -U watcher -d watcher -c "SELECT event_id, count(*) FROM check_results GROUP BY 1 HAVING count(*) > 1"
# Expected: 0 rows.

# 7) Poison message.
"this is not json" | docker compose exec -T kafka /opt/kafka/bin/kafka-console-producer.sh --bootstrap-server localhost:9092 --topic check.results
# Expected: the message appears on check.results.dlq; consumer remains running.

# 8) Redis outage/recovery. Check /health and the authenticated Pipeline card/API
# while Redis is stopped, then verify automatic recovery without app restart.
docker compose stop redis
docker compose exec api node -e "fetch('http://127.0.0.1:8080/health').then(async r=>console.log(r.status,await r.text()))"
docker compose start redis

# 9) Kafka outage/recovery. Check scheduler fallback logs, Postgres results, and
# the authenticated Pipeline card/API; then verify publishing resumes.
docker compose stop kafka
docker compose logs --tail 100 scheduler
docker compose exec -T db psql -U watcher -d watcher -c "SELECT count(*) FROM check_results WHERE checked_at > now() - interval '10 minutes'"
docker compose start kafka

# 10) Two schedulers: keep a 60-second monitor active for 10 minutes, then inspect
# rows in that window; expected count is about 10, not about 20.
docker compose up -d --scale scheduler=2 scheduler
docker compose exec -T db psql -U watcher -d watcher -c "SELECT monitor_id, count(*) FROM check_results WHERE checked_at > now() - interval '10 minutes' GROUP BY monitor_id"

# 11) Redis Streams driver. Use three PowerShell terminals and the isolated
# watcher_test database plus local Redis. Terminal 1:
$env:QUEUE_DRIVER = "redis-streams"
$env:DATABASE_URL = node --input-type=module -e "import 'dotenv/config'; const url = new URL(process.env.DATABASE_URL); url.pathname = '/watcher_test'; process.stdout.write(url.toString())"
$env:DIRECT_DATABASE_URL = $env:DATABASE_URL
$env:REDIS_URL = "redis://localhost:6379"
Push-Location backend
npm run dev:api
```

For terminal 2, repeat the five environment assignments above, then run:

```powershell
Push-Location backend
npm run dev:scheduler
```

For terminal 3, repeat the five environment assignments above, then run:

```powershell
Push-Location backend
npm run dev:consumer
```

Kafka is not required for this driver. Repeat delivery, catch-up, and idempotency checks.

```powershell
# 12) Rate-limit persistence: submit 11 invalid login attempts, restart API,
# then submit another invalid login; expected response remains 429.
$badPassword = [guid]::NewGuid().ToString()
$loginBody = @{ email = "invalid@example.invalid"; password = $badPassword } | ConvertTo-Json -Compress
for ($i = 0; $i -lt 11; $i++) {
  try {
    $r = Invoke-WebRequest -Method Post -Uri "http://localhost:3000/api/auth/login" -ContentType "application/json" -Body $loginBody
    $r.StatusCode
  } catch {
    $_.Exception.Response.StatusCode.value__
  }
}
docker compose restart api
try {
  (Invoke-WebRequest -Method Post -Uri "http://localhost:3000/api/auth/login" -ContentType "application/json" -Body $loginBody).StatusCode
} catch {
  $_.Exception.Response.StatusCode.value__
}

# 13) Full clean stack (only removes this Compose project's own volume).
docker compose down -v
docker compose up --build
# Expected: healthy services; register, add a monitor, see it go Up, and see a
# healthy Pipeline card at http://localhost:3000.

# Compose syntax check after Docker is installed.
docker compose config
```

## 12. Honesty attestation

- I ran the builds, lint, typechecks, unit tests, the Postgres-only integration subset, migration scenarios, npm audits, Docker availability checks, code/config searches, and a local production-preview browser smoke check. I did not run Docker Compose or any live Redis/Kafka runtime scenario.
- No test was skipped, weakened, or deleted to obtain a pass. One incorrectly credentialed integration attempt failed authentication and auto-skipped setup-dependent cases; the corrected run passed 8 tests with 0 skipped. The final preflight correctly stopped before running integration tests because Redis and Kafka were unavailable.
- No output in this report was invented or altered. Command output is trimmed only where indicated; environment credentials are omitted.
