# Watcher V3 Implementation and Verification Report

## 1. Executive verdict

**PARTIALLY VERIFIED**

V3 foundations, incident processing, channels, analytics, retention, OpenAPI,
the dashboard/settings implementation, CI configuration, and documentation are
present. The final backend suite passed 41 unit tests and 36 infrastructure-backed
integration tests. Backend and frontend static checks/builds passed; both
production dependency audits reported zero vulnerabilities.

This is not release verification. Docker is unavailable, so Compose was not
validated or started. No notification was delivered to a real endpoint, no
browser/mobile/accessibility walkthrough was performed, no GitHub Actions run
or deployment exists, and the V2 operational gate, live demo/screenshots, and
tag are incomplete. Email delivery and notifier retry/cooldown/recovery behavior
also lack end-to-end test evidence. Do not tag or deploy V3 yet.

## 2. Historical V2 baseline

- Previous report: the requested `backend/report.md` is absent. The historical
  report is the repository-root [`report.md`](../report.md); it is unchanged.
- Historical V2 verdict: **PARTIALLY VERIFIED**. It records passing code-level
  checks but blocked Docker/Redis/Kafka runtime scenarios.
- V3 source-document locations: the original V3 inputs remain in
  [`Implement/PRD-v3.md`](../Implement/PRD-v3.md) and
  [`Implement/implementation-v3.md`](../Implement/implementation-v3.md).
  Copies now also exist at [`docs/PRD-v3.md`](../docs/PRD-v3.md) and
  [`docs/implementation-v3.md`](../docs/implementation-v3.md). The V1/V2
  references are [`docs/PRD.md`](../docs/PRD.md),
  [`docs/PRD-v2.md`](../docs/PRD-v2.md), and
  [`docs/design.md`](../docs/design.md).
- Latest V2 evidence re-run during V3: the supplied historical terminal result
  was 9 integration files, 20 tests passed, 0 failed, 0 skipped, 83.03 seconds;
  that is prior user-provided evidence, not a fresh run here. In this
  continuation, `npm run test:integration` against the V3 branch passed 13
  files and 36 tests in 83.80 seconds, with 0 failed and 0 skipped. It includes
  V2 queue/result coverage, but does not prove the V2 operational acceptance
  scenarios.
- Step 0 gate: **BLOCKED**.
- Missing Step 0 evidence: Compose healthy-state check; live scheduler-published
  and consumer-consumed event-ID comparison; consumer stop/restart catch-up
  demonstration; complete V2 runtime regression (outages and two schedulers);
  and the required V2 commit/tag. The current tag listing contains neither
  `v2` nor `v3`.

## 3. Environment

- OS and shell: Windows, PowerShell.
- Node.js and npm: `v24.14.0`, `11.9.0`.
- Git branch and commit: local `v3`, HEAD
  `cfb795fc2aec8c211210abb294eba953fcec8b34`; no V3 commits were created.
- Docker CLI: unavailable. `docker --version` failed because `docker` was not
  recognized; daemon status and Compose checks could not be determined.
- PostgreSQL: `PostgreSQL 18.4`, reachable on port 5432.
- Redis: reachable on port 6379; version was not captured.
- Kafka: reachable on port 9092; version was not captured.
- Test databases: `watcher_test` for integration tests and
  `watcher_v3_scratch_20261119` for migration verification. The configured
  developer database `watcher` was not used for migration or integration
  verification.
- Services started: PostgreSQL, Redis, and Kafka were already reachable on the
  host. No API, frontend server, or Compose services were started.
- Temporary environment/config changes: test scripts injected test-only
  settings into child processes. Scratch migrations used a URL redirected to
  the isolated scratch database. No credentials or encryption key are included
  in this report; no persistent `.env` edit was made for these checks.

## 4. V3 step summary

| Step | Area                                        | Priority                     | Status             | Evidence / remaining work                                                                                                                                                         |
| ---: | ------------------------------------------- | ---------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|    0 | V2 gate                                     | Must prerequisite            | BLOCKED            | Integration suite passed; V2 live pipeline, catch-up, outage/two-scheduler checks, and tag remain missing.                                                                        |
|    1 | Quality foundations and request IDs         | Must / Should                | PASS               | Backend and frontend lint/format/type/build checks pass; request-ID tests pass. Frontend Oxlint prints two Fast Refresh warnings.                                                 |
|    2 | GitHub Actions and Dependabot               | Must                         | PARTIALLY VERIFIED | Workflow and weekly update config added; no PR or GitHub run was available.                                                                                                       |
|    3 | Migrations 6–9                              | Must                         | PASS               | All nine migrations were applied on an empty scratch DB in the prior verification; this continuation ran two no-op migrations there.                                              |
|    4 | Crypto, config, signing, masking            | Must / Should                | PARTIALLY VERIFIED | Encryption, tamper/version, mask, signature/body/timestamp and rendering tests pass; wrong-key behavior is not covered by a focused test.                                         |
|    5 | Transactional incident engine/outbox        | Must                         | PASS               | 9 real-Postgres incident-engine integration tests pass, including threshold, recovery, flapping, duplicate/late, and enqueue behavior.                                            |
|    6 | Monitor thresholds and incidents API        | Must                         | PARTIALLY VERIFIED | Routes and schemas implemented; engine scenarios pass. Dedicated authenticated incidents-route/threshold-edit tests and browser confirmation remain.                              |
|    7 | Channels API and secret handling            | Must                         | PARTIALLY VERIFIED | 2 real-Postgres API tests cover masking, one-time secret, ciphertext, ownership and invalid hosts. The channel test stubs DNS assertion; actual SSRF helper is tested separately. |
|    8 | Notifier, adapters, retries and recovery    | Must                         | PARTIALLY VERIFIED | Notifier and adapters exist; rendering/signature tests pass. Delivery/retry/cooldown/cap/crash/recovery/Redis-down paths are not end-to-end tested.                               |
|    9 | Email channel                               | Should                       | PARTIALLY VERIFIED | Resend adapter/configuration exists; no provider request or email delivery test was run.                                                                                          |
|   10 | Analytics, timeseries, cache                | Must                         | PASS               | 4 integration tests verify fixed stats, SQL percentile cross-check, `date_bin`, cache, and owner-before-cache behavior.                                                           |
|   11 | Navigation, incident banner, incidents page | Must                         | PARTIALLY VERIFIED | Frontend implementation builds and typechecks; no browser/responsive/keyboard check.                                                                                              |
|   12 | Monitor analytics and alert settings UI     | Must                         | PARTIALLY VERIFIED | Frontend implementation builds and typechecks; charts and interactions were not manually checked.                                                                                 |
|   13 | Settings, channels, notification history UI | Must                         | PARTIALLY VERIFIED | Frontend implementation builds and typechecks; no manual UI or real-channel check.                                                                                                |
|   14 | OpenAPI and Swagger UI                      | Must                         | PASS               | Spec validation, endpoint/scheme assertions, Swagger HTML, and route-specific CSP tests pass.                                                                                     |
|   15 | API keys                                    | Stretch                      | SKIPPED            | No API-key persistence/authentication/routes implemented; scheme is documented as reserved and disabled.                                                                          |
|   16 | Retention and Compose                       | Should / Must runtime wiring | PARTIALLY VERIFIED | Batched retention tested, Compose notifier/env wiring added; Docker config/startup not executable here.                                                                           |
|   17 | End-to-end and deployment                   | Must                         | BLOCKED            | No Compose stack, real notification flow, production deployment, or live checks.                                                                                                  |
|   18 | README, screenshots, design/docs, tag       | Must                         | PARTIALLY VERIFIED | README, design additions, and docs copies added. Live demo, screenshots/GIF, commit, and tag are absent.                                                                          |
|   19 | Final acceptance/interview preparation      | Must                         | NOT RUN            | Acceptance table and remaining actions are recorded below; no release sign-off or interview walkthrough.                                                                          |

## 5. Verification summary

Counts below are verification rows, not a count of individual assertions.
The test totals are reported separately to avoid counting the same assertions
twice.

| Check                             | Command / method                                           |                             Passed | Failed | Skipped | Status                        |
| --------------------------------- | ---------------------------------------------------------- | ---------------------------------: | -----: | ------: | ----------------------------- |
| Backend lint                      | `cd backend; npm run lint`                                 |                                  1 |      0 |       0 | PASS                          |
| Backend format                    | `cd backend; npm run format:check`                         |                                  1 |      0 |       0 | PASS                          |
| Backend typecheck                 | `cd backend; npm run typecheck`                            |                                  1 |      0 |       0 | PASS                          |
| Backend build                     | `cd backend; npm run build`                                |                                  1 |      0 |       0 | PASS                          |
| Backend unit tests                | `cd backend; npm test`                                     |                                 41 |      0 |       0 | PASS                          |
| Backend integration tests         | `cd backend; npm run test:integration`                     |                                 36 |      0 |       0 | PASS                          |
| Frontend lint                     | `cd frontend; npm run lint`                                |                                  1 |      0 |       0 | PASS (2 Oxlint warnings)      |
| Frontend format                   | `cd frontend; npm run format:check`                        |                                  1 |      0 |       0 | PASS                          |
| Frontend typecheck                | `cd frontend; npm run typecheck`                           |                                  1 |      0 |       0 | PASS                          |
| Frontend build                    | `cd frontend; npm run build`                               |                                  1 |      0 |       0 | PASS                          |
| Isolated migrations               | `npm run migrate` twice with scratch DB override           | 9 previously applied; 2 no-op runs |      0 |       0 | PASS                          |
| Production dependency audit       | `npm audit --omit=dev --audit-level=high` in both packages |                                  2 |      0 |       0 | PASS (0 vulnerabilities each) |
| OpenAPI/docs route checks         | Included in `npm test`                                     |                                  2 |      0 |       0 | PASS                          |
| Docker/Compose runtime            | `docker --version`, `docker info`                          |                                  0 |      0 |       0 | BLOCKED                       |
| V2 operational gate               | Manual Compose pipeline/catch-up/outage checks             |                                  0 |      0 |       0 | BLOCKED                       |
| Real notification lifecycle       | Real receiver/Compose notifier check                       |                                  0 |      0 |       0 | BLOCKED                       |
| GitHub Actions result             | Actual PR workflow                                         |                                  0 |      0 |       0 | NOT RUN                       |
| Frontend responsive/accessibility | Manual browser walkthrough                                 |                                  0 |      0 |       0 | NOT RUN                       |
| Production deployment             | Deployed app and live alert test                           |                                  0 |      0 |       0 | NOT RUN                       |
| README live demo/screenshots      | Live URL and captured screenshots/GIF                      |                                  0 |      0 |       0 | NOT RUN                       |
| Swagger Authorize/Try it out      | Authenticated browser request                              |                                  0 |      0 |       0 | NOT RUN                       |
| Email delivery                    | Resend/provider delivery                                   |                                  0 |      0 |       0 | NOT RUN                       |
| API keys                          | Stretch implementation/tests                               |                                  0 |      0 |       0 | SKIPPED                       |

**Verification-row totals:** 13 PASS, 0 final FAIL, 1 SKIPPED, 3 BLOCKED, and
6 NOT RUN. The backend suites ran 77 tests total (41 unit + 36 integration),
with 0 failed and 0 skipped.

## 6. Detailed implementation and evidence

### Step 0 — V2 gate: BLOCKED

- **Requirements covered:** V2 remains the baseline and must pass before V3
  release.
- **Files changed:** None for this gate.
- **Implementation summary:** Current V3 integration tests include real Kafka
  and Redis Streams contract coverage, Postgres results/state, ownership,
  incident, channel, analytics, and retention tests.
- **Evidence:** In `backend`, `npm run test:integration` exited 0:
  `Postgres (watcher_test): reachable`, `Redis: reachable`, `Kafka: reachable`,
  `Test Files 13 passed (13)`, `Tests 36 passed (36)`, `Duration 83.80s`.
- **Tests:** 36 passed / 0 failed / 0 skipped.
- **Remaining issues:** Docker Compose is unavailable. The live scheduler /
  consumer event-ID check, catch-up demonstration, failure scenarios, V2 tag,
  and V2 commit condition are not evidenced.

### Step 1 — Quality foundations and request IDs: PASS

- **Requirements covered:** Flat ESLint configs, Prettier, package scripts,
  request IDs, V3 retention default.
- **Files changed:** Both package manifests and ESLint configs; backend
  `src/lib/requestId.ts`, logger, error handling, environment config; both
  Prettier configs/ignore files.
- **Implementation summary:** Both packages have lint, format, format-check,
  and typecheck scripts. Backend lint uses `--max-warnings 0`; frontend lint
  runs ESLint with that setting and Oxlint. Request IDs are echoed in headers,
  attached to logs, and returned in error bodies. `RESULT_RETENTION_DAYS`
  defaults to 8.
- **Evidence:** Backend `npm run lint`, `npm run format:check`,
  `npm run typecheck`, `npm run build`, `npm test` all exited 0. Frontend
  equivalents, including `npm run build`, exited 0. Unit tests:
  41 passed / 0 failed / 0 skipped.
- **Tests:** Request-ID suite: 2 passed. The frontend lint command prints two
  existing `react/only-export-components` Oxlint warnings in `AuthContext.tsx`
  and `StatusBadge.tsx`, but exits 0.
- **Remaining issues:** The plan's manual `curl` check was not run because no
  API server was started.

### Step 2 — GitHub Actions and Dependabot: PARTIALLY VERIFIED

- **Requirements covered:** Backend, frontend, Docker-build, and dependency
  audit automation; weekly update configuration.
- **Files changed:** `.github/workflows/ci.yml`, `.github/dependabot.yml`.
- **Implementation summary:** Workflow includes Postgres/Redis services,
  Kafka startup, migrations, backend integration tests, frontend quality/build,
  Compose image build, and production dependency audits. Dependabot covers npm,
  GitHub Actions, and Docker under both packages.
- **Evidence:** Static review only. No branch push, pull request, or GitHub run
  was performed.
- **Tests:** 0 passed / 0 failed / 0 skipped for a hosted CI run.
- **Remaining issues:** Run the workflow on a PR and address any hosted
  environment issues before treating CI as verified.

### Step 3 — Migrations 6–9: PASS

- **Requirements covered:** Monitor alert settings, incidents, channels,
  notifications/outbox, and clean-database migration.
- **Files changed:** `backend/migrations/1700000000006_...` through
  `1700000000009_...`.
- **Implementation summary:** Four migrations add monitor thresholds and the
  incident/channel/notification tables and indexes.
- **Evidence:** Prior verification applied all nine migrations from empty
  `watcher_v3_scratch_20261119`. This continuation ran `npm run migrate` twice
  with `DATABASE_URL` and `DIRECT_DATABASE_URL` redirected to that scratch DB;
  both runs printed `No migrations to run!` and `Migrations complete!`.
- **Tests:** 9 migration records present from the previous scratch verification;
  two current no-op runs passed.
- **Remaining issues:** No migration was run against the developer database.
  Compose's migration container was not started.

### Step 4 — Crypto, config, signing, masking: PARTIALLY VERIFIED

- **Requirements covered:** AES-256-GCM encryption, signatures, timestamp
  tolerance, URL/email masking, environment validation, logging redaction.
- **Files changed:** `backend/src/lib/crypto.ts`, its tests, environment config,
  logger, and `.env.example`.
- **Implementation summary:** `v1:` AES-GCM envelopes use a fresh IV; webhook
  helpers sign the raw body and verify timestamps/signatures; targets and
  emails are masked. Config validates the key for API/notifier roles.
- **Evidence:** `npm test` includes 4 crypto tests; notifier rendering/signing
  tests add 2 more. Final unit result: 41 passed / 0 failed / 0 skipped.
- **Tests:** Round trip/fresh envelope, tampering/unknown version, masking, raw
  body signature, stale timestamp, and generated webhook signature covered.
- **Remaining issues:** Wrong-key behavior and real delivery/receiver
  verification have no separate focused test. Logger redaction was not checked
  against a live secret-bearing delivery log.

### Step 5 — Transactional incident engine/outbox: PASS

- **Requirements covered:** Incident threshold/open/update/resolve transitions
  and notification enqueue in the result transaction.
- **Files changed:** `backend/src/incidents/engine.ts`,
  `backend/src/modules/results/result.service.ts`, migration 7/9, integration
  tests.
- **Implementation summary:** Result write, monitor state update, incident
  transition, and outbox insert run transactionally; dedupe and one-open
  partial indexes back up application logic.
- **Evidence:** `npm run test:integration` passed 9
  `incidentEngine.test.ts` cases.
- **Tests:** Covers threshold, subsequent failures, resolution, recovery streak
  reset, below-threshold flapping, duplicate and late events, disabled alerts,
  inactive channels, threshold 1, and enqueue counts. 9 passed / 0 failed /
  0 skipped.
- **Remaining issues:** No manual SQL inspection or notification delivery was
  performed.

### Step 6 — Monitor thresholds and incidents API: PARTIALLY VERIFIED

- **Requirements covered:** Per-monitor failure/recovery thresholds, alert
  enablement, incident listing/detail data.
- **Files changed:** Monitor schemas/service/routes and
  `backend/src/modules/incidents/`.
- **Implementation summary:** Monitor create/update exposes alert settings;
  incident API is owner-scoped and supports status/cursor filtering.
- **Evidence:** Incident transition behavior is exercised by the 9 integration
  tests; backend typecheck/build and full integration suite pass.
- **Tests:** Engine tests pass; no dedicated HTTP integration coverage for
  incident filters, pagination, or threshold editing was run.
- **Remaining issues:** Add route-level ownership/filter tests and verify the
  incidents page in a browser.

### Step 7 — Channels API and secret handling: PARTIALLY VERIFIED

- **Requirements covered:** Channel CRUD, ownership, masking, one-time webhook
  secret, encrypted storage, host restrictions.
- **Files changed:** `backend/src/modules/channels/`, migration 8, channel
  integration tests.
- **Implementation summary:** Create/list/update/delete/test endpoints are
  implemented; API responses expose masked targets and create returns the
  signing secret once.
- **Evidence:** `channels.test.ts` passed 2 real-Postgres integration tests.
  The test verified `v1:` ciphertext, absence of the full target/secret from
  subsequent responses, and a foreign owner's 404. SSRF assertion is stubbed
  in the valid-channel test to avoid DNS/network reliance; the separate SSRF
  unit suite has 2 passing tests.
- **Tests:** 2 channel tests passed; invalid localhost and non-official Slack
  host cases return 400.
- **Remaining issues:** Channel limit, create/update/delete history behavior,
  real DNS-resolution blocking, and live outbound delivery were not fully
  exercised.

### Step 8 — Notifier and adapters: PARTIALLY VERIFIED

- **Requirements covered:** Outbox claim, Slack/Discord/webhook adapters,
  retries, cooldown, caps, crash recovery, delivery history.
- **Files changed:** `backend/src/notifier/`, notifier role and notification
  APIs.
- **Implementation summary:** A notifier role claims due rows, uses
  `SKIP LOCKED`/lease timestamps, records outcomes, supports retry/backoff,
  suppression, and signs generic webhook payloads.
- **Evidence:** Rendering/signature tests pass as part of the 41 backend unit
  tests. Incident integration verifies atomic enqueue.
- **Tests:** No notifier process/delivery integration suite was run.
- **Remaining issues:** HTTP success, 503 retries, 404 permanent failure,
  429 handling, cooldown, hourly cap, deleted channels, lease recovery,
  multiple notifiers, and Redis-down fail-open need direct tests.

### Step 9 — Email channel: PARTIALLY VERIFIED

- **Requirements covered:** Optional Resend HTTPS delivery.
- **Files changed:** `backend/src/notifier/adapters/email.ts`, config and
  channel type handling.
- **Implementation summary:** Email is gated behind `EMAIL_PROVIDER=resend`;
  recipient is the account email and calls use the HTTPS API.
- **Evidence:** Static implementation review; no provider credentials or test
  capture endpoint were used.
- **Tests:** 0 email delivery tests passed / 0 failed / 0 skipped (not run).
- **Remaining issues:** Add mocked provider response tests and an explicitly
  identified request-capture/live provider check if email remains in scope.

### Step 10 — Analytics: PASS

- **Requirements covered:** Uptime, average/min/max, p50/p95/p99, time series,
  Redis cache, owner check before cache access.
- **Files changed:** `backend/src/modules/analytics/`, integration tests.
- **Implementation summary:** PostgreSQL aggregates use successful checks for
  latency; `date_bin` groups time-series values; Redis caches stats/series.
- **Evidence:** `analytics.test.ts` passed 4 integration tests against
  PostgreSQL and Redis. Fixed dataset values were checked against direct SQL;
  cache stayed stable after a new insert, and a foreign user received
  `Monitor not found` before cache use.
- **Tests:** 4 passed / 0 failed / 0 skipped, including null latency and
  sorted/aligned bucket checks.
- **Remaining issues:** No visual chart/browser check.

### Step 11 — Navigation, banner, incidents page: PARTIALLY VERIFIED

- **Requirements covered:** New routes/navigation and incident surfaces.
- **Files changed:** Frontend app/navigation, incident API and page, dashboard
  and styling files (the frontend steps were implemented in a delegated
  change).
- **Implementation summary:** Build includes Incidents page and lazy-loaded
  sections.
- **Evidence:** `frontend` lint, format, typecheck, and production build all
  exited 0. Build emitted a 2.71 kB Incidents chunk.
- **Tests:** Automated browser tests/manual responsive and keyboard checks
  were not run.
- **Remaining issues:** Verify 360px layout, keyboard focus, polling, empty and
  error states, and navigation in the browser.

### Step 12 — Monitor analytics/settings UI: PARTIALLY VERIFIED

- **Requirements covered:** Stats, uptime/time-series charts, incident notice,
  and alert settings.
- **Files changed:** Monitor detail/API and styling.
- **Implementation summary:** Analytics and monitor alert controls compile;
  `MonitorDetail` is emitted as a 432.91 kB chunk.
- **Evidence:** Frontend lint, format, typecheck, and build exited 0.
- **Tests:** No browser check of charts, tooltips, polling, or modal keyboard
  behavior.
- **Remaining issues:** Compare rendered stats and chart values to the verified
  API response and check keyboard/mobile behavior.

### Step 13 — Settings/channels/history UI: PARTIALLY VERIFIED

- **Requirements covered:** Channel management, test action, one-time secret,
  and notification history.
- **Files changed:** Settings page and channel/notification API clients.
- **Implementation summary:** Settings UI is present and compiled; Settings
  chunk is 7.27 kB.
- **Evidence:** Frontend lint, format, typecheck, and build exited 0.
- **Tests:** No manual responsive/accessibility or real-channel test.
- **Remaining issues:** Verify add/edit/delete/test, one-time secret copy,
  loading/error/empty states, and history polling in a browser.

### Step 14 — OpenAPI and Swagger UI: PASS

- **Requirements covered:** OpenAPI generation, auth schemes, docs endpoint,
  CSP isolation.
- **Files changed:** `backend/src/docs/`, route registry and docs tests.
- **Implementation summary:** Zod schemas feed the generated document. API
  routes advertise bearer auth only; API-key scheme is explicitly marked
  reserved/disabled. Swagger's relaxed inline-script CSP is route-local.
- **Evidence:** 2 tests in `src/docs/openapi.test.ts` validate the generated
  OpenAPI document, expected V3 paths/schemes, `/api/docs/` HTML, and
  `script-src` difference from `/api/monitors`.
- **Tests:** 2 passed / 0 failed / 0 skipped.
- **Remaining issues:** Authenticated Swagger “Try it out” and full V1/V2/V3
  route/response completeness were not manually verified.

### Step 15 — API keys: SKIPPED

- **Requirements covered:** Stretch API-key support.
- **Files changed:** No API-key storage/auth/routes/migration were added. The
  OpenAPI scheme is only a reserved declaration.
- **Implementation summary:** Skipped in accordance with Stretch priority.
- **Evidence:** Static route/security review; monitor paths advertise bearer
  auth only.
- **Tests:** 0 passed / 0 failed / 0 skipped (feature skipped).
- **Remaining issues:** Implement migration, hashed key storage, one-time
  display, revoke, auth restrictions, and API tests only if the Stretch item
  is later prioritized.

### Step 16 — Retention, Compose, housekeeping: PARTIALLY VERIFIED

- **Requirements covered:** Batched cleanup of results, final notifications,
  resolved incidents, and stale refresh tokens; notifier Compose service.
- **Files changed:** `backend/src/scheduler/retention.ts`, integration tests,
  `docker-compose.yml`, README.
- **Implementation summary:** Retention deletes in batches of 5000 and filters
  to final notifications and resolved incidents; open incidents are excluded.
  Compose adds notifier and local-only V3 environment defaults.
- **Evidence:** `retention.test.ts` passed against `watcher_test`, retaining an
  old open incident and pending notification while deleting eligible data.
  `docker --version` failed because Docker is unavailable.
- **Tests:** 1 retention integration test passed / 0 failed / 0 skipped.
- **Remaining issues:** Compose syntax/build/startup and notifier health check
  remain unverified.

### Step 17 — End-to-end verification and deploy: BLOCKED

- **Requirements covered:** Full Compose startup, real notification flow,
  outages/retries/recovery, deployment.
- **Files changed:** No deployment configuration or production secrets were
  added.
- **Implementation summary:** Code and test scaffolding are present, but no
  real receiver or deployed environment was used.
- **Evidence:** Docker CLI unavailable; no deployment URL or GitHub run exists.
- **Tests:** 0 end-to-end or production tests passed / 0 failed / 0 skipped
  (not run).
- **Remaining issues:** Install/use Docker, run all PRD scenarios, configure a
  real receiver safely, then deploy only after CI passes.

### Step 18 — README, screenshots, docs, and tag: PARTIALLY VERIFIED

- **Requirements covered:** V3 architecture/design docs, repo README and
  screenshot/live-link readiness.
- **Files changed:** Root `README.md`, `docs/design.md`, copied V3 docs.
- **Implementation summary:** README now describes V3 features, architecture,
  outbox, security, failure behavior, local setup, and known limitations;
  V3 PRD and plan are copied into `docs/`.
- **Evidence:** Static review only. No screenshots/GIF or live URL was
  fabricated. `report.md` remains unchanged; no commit/tag was created.
- **Tests:** Documentation checks not defined.
- **Remaining issues:** Capture real screenshots after browser verification,
  add a real live link only after deployment, commit the finished work, and
  create a tag only after acceptance passes.

### Step 19 — Final acceptance and interview preparation: NOT RUN

- **Requirements covered:** Line-by-line PRD sign-off and architectural
  interview preparation.
- **Files changed:** This report records evidence and outstanding acceptance
  items.
- **Implementation summary:** No release sign-off is claimed.
- **Evidence:** Acceptance matrix and V2 regression table below.
- **Tests:** Not applicable.
- **Remaining issues:** Complete all blocked/not-run Must acceptance criteria,
  rerun final checks, and review the architecture decisions before sign-off.

## 7. PRD acceptance criteria

| PRD acceptance criterion                                           | Status             | Evidence                                                                                                                                                |
| ------------------------------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Slack/Discord/webhook test delivered and history is Sent        | BLOCKED            | Channel API tested; no real test delivery or notifier process run.                                                                                      |
| 2. Incident opens once; dashboard banner and one alert per channel | PARTIALLY VERIFIED | Engine integration verifies threshold/open and enqueue once; no real delivery or dashboard browser check.                                               |
| 3. Incident resolves once and duration appears in UI               | PARTIALLY VERIFIED | Engine integration verifies resolution/outbox; no browser or delivered recovery message.                                                                |
| 4. Flapping thresholds/cooldown suppression visible                | PARTIALLY VERIFIED | Below-threshold flapping test passes; cooldown suppression/history behavior not exercised end-to-end.                                                   |
| 5. 503 retries and 404 fails immediately                           | NOT RUN            | No delivery/retry test.                                                                                                                                 |
| 6. Notifier crash recovery                                         | NOT RUN            | No notifier stop/restart test.                                                                                                                          |
| 7. Redis-down alerts still send                                    | NOT RUN            | Redis-down notifier fail-open was not tested.                                                                                                           |
| 8. Ciphertext stored; target/secret absent from API/logs           | PARTIALLY VERIFIED | DB ciphertext and response masking/one-time secret verified; live delivery logs not inspected.                                                          |
| 9. Receiver verifies webhook signature                             | PARTIALLY VERIFIED | HMAC/body/timestamp helpers and generated signature tested; no external receiver.                                                                       |
| 10. Stats/charts/uptime bar match SQL                              | PARTIALLY VERIFIED | API values, percentiles and buckets cross-checked with SQL; browser charts not checked.                                                                 |
| 11. Swagger UI, auth, Try it out, OpenAPI validation               | PARTIALLY VERIFIED | Spec validation, docs HTML and CSP pass; authenticated Try it out not run.                                                                              |
| 12. API keys create/call/revoke                                    | SKIPPED (Stretch)  | Feature not implemented.                                                                                                                                |
| 13. Quality commands in both packages                              | PASS               | Backend and frontend lint/format/typecheck/build pass; backend unit/integration suites pass. Frontend has no test scripts; Oxlint reports two warnings. |
| 14. V2 catch-up, poison, outage, two-scheduler regressions         | PARTIALLY VERIFIED | Integration queue/result tests pass; live operational scenarios remain blocked.                                                                         |
| 15. GitHub PR CI passes                                            | NOT RUN            | Workflow added, no PR/run.                                                                                                                              |
| 16. Deployed app opens/resolves a real incident and alert          | NOT RUN            | No deployment or production check.                                                                                                                      |
| 17. Complete README with live link, badge, screenshots/GIF         | PARTIALLY VERIFIED | Badge, architecture, features, and limitations added; live link and screenshots are unavailable.                                                        |
| 18. Repository committed and tagged `v3`                           | NOT RUN            | No new commit or tag.                                                                                                                                   |

## 8. Security and data safety

- **Encryption:** AES-256-GCM `v1:` envelopes and fresh encryption randomness
  have unit coverage. The channel integration test confirmed stored target
  and signing secret values begin with `v1:` and are not plaintext.
- **Masking/one-time secret:** channel create/list integration coverage
  confirmed the URL is not returned and the signing secret is absent from later
  list responses. The create response returns it once.
- **Log redaction:** logger redaction configuration was added/updated. No
  runtime secret-bearing delivery was performed to search logs.
- **SSRF:** the existing SSRF unit suite passed 2 tests. Channel URL API tests
  stubbed the DNS assertion for deterministic API behavior; they are not proof
  of connect-time DNS rebinding protection. No notifier request was sent.
- **Webhook signatures:** HMAC-SHA-256 raw-body signature, modified-body
  rejection, stale timestamp rejection, and generated adapter signature are
  covered by unit tests. No external receiver was used.
- **Ownership/auth:** integration tests cover channel foreign-owner 404 and
  analytics ownership-before-cache. Existing authenticated monitor/owner
  integration coverage also passed in the full suite. API-key auth is not
  implemented and routes do not advertise it as supported.
- **CSP:** OpenAPI tests confirmed Swagger UI permits inline scripts only on
  the docs route; API script-src remains strict. Helmet's default style
  directive still includes its normal inline style allowance.
- **Migration/test safety:** migration no-op checks used only the isolated
  scratch database. Integration tests used `watcher_test`; `watcher` was not
  targeted. One earlier attempt with sample DB credentials failed
  authentication and was rerun with the configured connection redirected to a
  test database. No secret value is reproduced here.
- **Compose development key:** Compose contains a fixed local-only development
  encryption key as prescribed for local startup. It must never be reused in
  production; production key provisioning/backup is not verified.

## 9. V2 regression results

| V2 scenario                                    | Status             | Evidence                                                                                 |
| ---------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------- |
| Event idempotency and late results             | PASS               | Real-Postgres `recordResult` integration tests pass.                                     |
| Kafka delivery/DLQ/redelivery contract         | PARTIALLY VERIFIED | Kafka queue contract tests pass in integration; no operational poison/outage drill.      |
| Redis Streams delivery/redelivery contract     | PASS               | Redis Streams queue contract tests pass in integration.                                  |
| Consumer catch-up after stop/restart           | BLOCKED            | Requires running broker/services and manual consumer lifecycle; not performed.           |
| Poison message behavior in live pipeline       | PARTIALLY VERIFIED | Unit/integration queue behavior exists; no live end-to-end poison-message demonstration. |
| Kafka outage/fallback/recovery                 | BLOCKED            | No outage/recovery runtime test.                                                         |
| Redis outage/fail-open locks/cache/rate limits | BLOCKED            | Unit tests exercise mocked failures; no live Redis outage drill.                         |
| Two schedulers without duplicate checks        | BLOCKED            | No concurrent Compose scheduler test.                                                    |
| Full V2 stack/browser acceptance               | BLOCKED            | Docker unavailable; no stack or browser session.                                         |

## 10. Skipped, blocked, and failed items

- **Docker/Compose, V2 operational gate, full notifier E2E:** blocked because
  `docker --version` returned “The term 'docker' is not recognized”. Next:
  provide a working Docker CLI/daemon, run Compose health/build checks, then
  execute the V2 and V3 lifecycle scenarios.
- **GitHub CI:** workflow exists but was not pushed or run. Next: push/open a
  PR and retain the actual run URL/results.
- **Manual UI/accessibility, Swagger Try it out, screenshots/live demo, deploy:**
  not run because no app server or deployed target was started. Next: start the
  verified Compose stack, exercise the app at desktop/mobile sizes, and capture
  redacted screenshots only after real verification.
- **Notifier delivery/retry/recovery and email:** no receiver/provider was
  configured. Next: add deterministic notifier tests for success, 503/404/429,
  cooldown, cap, deleted channel, lease reclaim, multiple workers, and Redis
  failure; then use an explicitly identified capture endpoint for E2E.
- **API keys:** explicitly skipped as Stretch.
- **Failed attempts and corrections:**
  - An early backend build failed on OpenAPI security typing. The security
    requirement was given an explicit record-array type; final build passed.
  - Lint first reported an unused `channelResponse`; it was wired into channel
    response schemas. Final backend lint passed.
  - Early OpenAPI tests exposed Zod extension initialization, Swagger Parser
    type/string handling, and an overly broad CSP assertion. The registry now
    extends local schemas, validates a JSON document object, and checks only
    the script-src policy. Final OpenAPI tests passed.
  - Backend `format:check` initially reported `handleMessage.ts`,
    `publish.ts`, and after a later edit `openapi.ts`; formatting was rerun and
    final format check passed.
  - An initial migration attempt with sample credentials failed
    authentication; it was rerun with the configured database URL redirected
    to the isolated scratch DB. An initial scratch-create command had quoting
    trouble and was corrected.
  - An initial crypto tamper test changed insignificant base64 padding and did
    not fail; the test was corrected to flip an actual ciphertext byte.
  - Integration output included Kafka topic-creation error/warning logs and
    Node `TimeoutNegativeWarning`; the suite still exited 0 with all 36 tests
    passing. Investigate these warnings before relying on hosted CI.

## 11. Changed files and repository state

- Important files changed: V3 migrations 6–9; backend config, request IDs,
  crypto, incident engine, notifier, channels/incidents/notifications/
  analytics modules, OpenAPI registry, retention, and tests; frontend
  navigation/pages/API clients/monitor detail; CI/Dependabot; Compose; README;
  `docs/design.md`; copied V3 PRD and plan.
- Branch: `v3`.
- Commit hashes: current HEAD is
  `cfb795fc2aec8c211210abb294eba953fcec8b34`; no V3 commit was created.
- Working tree status: dirty with uncommitted V3 changes and formatting
  updates. `git diff --check` exited 0. A fresh final `git status --short`
  should be used before staging/committing.
- Historical report: root [`report.md`](../report.md) remains unchanged;
  `backend/report.md` does not exist.
- CI/PR links: none.
- Deployment URLs: none.
- Tag: none; neither `v2` nor `v3` was present in the tag listing.

## 12. Final recommendation

V3 is **PARTIALLY VERIFIED**, not production-ready. Preserve the separate `v3`
branch. Before release, in priority order:

1. Make Docker available; validate Compose and run the complete V2 gate and V3
   notifier/incident scenarios.
2. Add direct notifier tests for retries, cooldown, hourly cap, crash recovery,
   concurrency, SSRF, and Redis-down behavior; add wrong-key and email tests.
3. Perform browser responsive/keyboard/accessibility checks and authenticated
   Swagger requests.
4. Run the new CI workflow on a PR and fix any failures or warnings.
5. Capture real, redacted screenshots and deploy only after CI and E2E pass.
6. Re-run all checks, review the final diff/status, then commit/tag only when
   acceptance criteria and the V2 prerequisite are satisfied.
