# Watcher V3: Implementation Plan

> **Your APIs. Always in Sight.**

Companion to `PRD-v3.md`. The PRD says **what** changes. This file says **in what order**, and how to check each step before moving on.

## How to use this with an AI agent

1. Put `PRD-v3.md` and this file in `docs/` next to the V1 and V2 documents and `design.md`.
2. Start the agent session with this **master prompt**:

   > Read `docs/PRD-v3.md` fully. It describes only what changes from Version 2, so also keep `docs/PRD.md`, `docs/PRD-v2.md`, and `docs/design.md` in mind. We are building Version 3 step by step following `docs/implementation-v3.md`. Do only the step I name. Use the exact table names, routes, env vars, and copy from the PRD. Respect the priority labels (Must, Should, Stretch) and don't add features that are not in the PRD. Do not change V1 or V2 behavior unless the PRD says so. After each step, tell me how to verify it, and tell me honestly if you could not run something.

3. Send one step at a time: *"Do Step N from implementation-v3.md."*
4. Run the **Verify** block yourself. Do not move on until it passes.
5. **Commit after every step** on a `v3` branch.
6. **Do not trust "implemented".** An agent without Docker, Redis, or Kafka cannot prove the pipeline works. Anything it says it could not run is yours to run.
7. Read the code for the parts you will be asked about in interviews (marked with a book icon below: 📖).

**Time budget (about 1.5 to 2 days of focused work):**

| Block | Steps | Rough time |
|---|---|---|
| Foundation | 0 to 2 | 1.5 h |
| Data and incident engine | 3 to 6 | 4 h |
| Channels and notifier | 7 to 9 | 4 h |
| Analytics | 10 | 1.5 h |
| Frontend | 11 to 13 | 4.5 h |
| Docs and API keys | 14 to 15 | 2.5 h |
| Housekeeping and deploy | 16 to 17 | 2 h |
| Finish | 18 to 19 | 1.5 h |

**If time runs short, cut in this order:** Step 15 (API keys, Stretch), then Step 9 (email, Should), then the p99, min, and max extras and the stats cache in Step 10. Never leave a Must step half-built.

---

## Step 0: Version 2 gate (do not skip)

V3 is built on V2's pipeline. Check all of this yourself first:

- [ ] `docker compose up -d db redis kafka` shows all three healthy.
- [ ] `npm run test:integration` passes with **nothing skipped**.
- [ ] `npm run dev` works: add a monitor and see the same `eventId` in a scheduler "published" log line and a consumer "consumed" log line.
- [ ] The catch-up demo works: stop the consumer for a few checks, restart it, and the lag returns to 0 with no gaps.
- [ ] `npm run migrate` prints each migration it applies, and `select name from pgmigrations;` lists all five (V1's four plus V2's).
- [ ] Everything is committed and tagged `v2`.

Then create the branch:
```bash
git checkout -b v3
```

---

## Step 1: Quality foundations

**Goal:** lint, format, and typecheck work in both packages, and every request carries an ID. (V2's ESLint failed for lack of a config. Fix that first so every later step is checked.)

**Tasks**
1. Backend and frontend: install the lint and format tools from PRD section 2, add `eslint.config.js` (flat config) and `.prettierrc` and `.prettierignore` per PRD 14.1.
2. Add the scripts `lint`, `typecheck`, `format`, and `format:check` to both `package.json` files. Lint uses `--max-warnings 0`.
3. Run `format` once, then fix what `lint` and `typecheck` report. Keep fixes behavior-neutral.
4. Request IDs (PRD 10.8): a middleware that accepts a valid UUID from `x-request-id` or generates one, sets the response header, passes the ID to pino-http, and adds `error.requestId` to error responses.
5. Change the default `RESULT_RETENTION_DAYS` to 8 in `.env.example` and the config schema.

**Verify**
```bash
cd backend && npm run lint && npm run format:check && npm run typecheck && npm test
cd ../frontend && npm run lint && npm run format:check && npm run typecheck && npm run build
curl -i localhost:8080/api/monitors     # 401 with an x-request-id header and error.requestId in the body
curl -i -H "x-request-id: not-a-uuid" localhost:8080/health   # a fresh UUID is returned, not the bad value
```

**Commit:** `step 1: lint, format, typecheck, request ids`

---

## Step 2: CI pipeline

**Goal:** every later step is checked automatically on GitHub.

**Tasks**
1. Add `.github/workflows/ci.yml` as in PRD 14.2 (backend with Postgres and Redis service containers and Kafka via Compose, frontend, docker build, audit).
2. Add `.github/dependabot.yml` per PRD 14.3.
3. Pin the action versions to the current major releases.
4. Push the branch and open a pull request to `main`.

**Verify**
- All four jobs go green on the pull request. If the backend job fails only on the Kafka step, run `docker compose up -d --wait kafka` locally and read the logs, since the usual problem is the health check timing out.
- Add a badge line to the README: `![CI](https://github.com/<you>/<repo>/actions/workflows/ci.yml/badge.svg)`.

**If the `audit` job fails** on a high-severity advisory, update the dependency. If no fix exists, note it in the README's known limitations and mark that job as non-blocking for now rather than hiding it.

**Commit:** `step 2: github actions and dependabot`

---

## Step 3: Migrations 6 to 9 (and 10 later)

**Goal:** the new tables and columns exist. Stretch migration 10 is added in Step 15.

**Tasks**
1. Add the four migration files exactly as in PRD sections 4.1 to 4.4.
2. Run them through `npm run migrate`. Do not apply them by hand.

**Verify**
```bash
npm run migrate        # prints the four new migrations
npm run migrate        # second run: nothing to apply
```
In psql or pgAdmin:
```sql
\d monitors            -- failure_threshold, recovery_threshold, alerts_enabled, consecutive_successes, failure_streak_started_at
\d incidents           -- unique partial index incidents_one_open_per_monitor
\d notifications       -- unique partial index notifications_dedupe_uq
select name from pgmigrations order by id;   -- nine rows
```
**Also test on an empty database** (this is what Neon will be): create a scratch database `watcher_scratch`, point `DATABASE_URL` at it, run `npm run migrate`, and confirm all nine migrations apply cleanly from nothing. Then switch back.

**Commit:** `step 3: v3 migrations`

---

## Step 4: Crypto, config, and signing helpers

**Goal:** the secret-handling building blocks, tested before anything depends on them.

**Tasks**
1. Add all new env vars from PRD 13.1 to `.env.example` and the zod config schema, with the boot validation rules listed there. Generate your own key and add it to your `.env`:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
2. `src/lib/crypto.ts` per PRD 7.5: `encrypt(plain)` and `decrypt(stored)` using AES-256-GCM, a random 12-byte IV, the `v1:` format, and errors for tampering, wrong key, or unknown version.
3. Add signing helpers: `signWebhook(secret, timestamp, rawBody)` and `verifyWebhookSignature(...)` (HMAC-SHA-256, constant-time comparison, a 5 minute timestamp tolerance).
4. Add `maskTarget(url)` and `maskEmail(email)` helpers (PRD 7.5, 10.5).
5. Extend the pino redaction list per PRD 7.5.
6. Write `tests/crypto.test.ts` (PRD 16 items 5 and 6).

**Verify**
```bash
npm test -- crypto
# Boot with a bad key must fail clearly:
#   PowerShell:  $env:ENCRYPTION_KEY="abc"; npm run dev:api
```
📖 Read `crypto.ts` once. Be able to say why GCM needs a unique IV per value and what the auth tag protects against.

**Commit:** `step 4: crypto and signing helpers`

---

## Step 5: Incident engine

**Goal:** incidents open and resolve inside the result transaction, with the outbox rows created atomically.

**Tasks**
1. Extend the monitor `UPDATE` in `recordResult` with the streak columns exactly as in PRD section 5.
2. `src/incidents/engine.ts`: a function that takes the open transaction, the updated monitor row, and the event, and returns the incident outcome. Implement the rules in PRD 6.1:
   - `SELECT ... FOR UPDATE` on the open incident
   - open with `ON CONFLICT DO NOTHING` on the partial unique index
   - update counters on further failures
   - resolve when the recovery threshold is reached
3. Enqueue notifications per PRD 6.2 (active channels of the monitor's owner, only if `alerts_enabled`, payload as specified, `ON CONFLICT ... DO NOTHING`).
4. Return the new `incident` field from `recordResult` (PRD section 5). Existing callers keep working.
5. Write `tests/incidentEngine.test.ts` covering **every row of the table in PRD 6.3**, driven by `recordResult`. Add the notification enqueue tests (PRD 16 item 2).

**Verify**
```bash
npm test -- incidentEngine
```
Then by hand in psql, with a monitor and a channel row inserted manually, replay results with the `event:replay`-style script from V2 (or the tests' helpers) and confirm:
```sql
select id, monitor_id, started_at, resolved_at, failed_checks from incidents;
select type, status, channel_name from notifications order by created_at;
```
📖 Read `engine.ts` and the changed `UPDATE`. Be able to explain, without looking, why `consecutive_failures = 0` in the `CASE` refers to the previous check, and why a duplicate event cannot create a second incident or notification.

**Commit:** `step 5: incident engine`

---

## Step 6: Monitor changes and the incidents API

**Goal:** thresholds are configurable, and incidents are visible through the API.

**Tasks**
1. Monitors: accept `failureThreshold`, `recoveryThreshold`, `alertsEnabled` in create and update schemas (PRD 10.1). Return them, plus `openIncident`, in the monitor object. Load open incidents for a list with **one** query, not one per monitor.
2. `modules/incidents/`: `GET /api/incidents` per PRD 10.4, with the incident object in 10.3 (`durationSeconds` computed for open incidents), `status`, `monitorId` (must be owned), `limit`, and `before`. Always scope by the owner through the monitor.
3. Mount at `/api/incidents`.
4. Tests: ownership (another user's `monitorId` returns 404, and their incidents never appear), filters, and pagination.

**Verify**
```bash
curl -H "authorization: Bearer $T" "localhost:8080/api/incidents?status=open"
curl -H "authorization: Bearer $T" "localhost:8080/api/monitors"     # includes thresholds and openIncident
# PATCH a monitor with {"failureThreshold": 11} -> 400 VALIDATION_ERROR
```

**Commit:** `step 6: monitor thresholds and incidents api`

---

## Step 7: Channels API

**Goal:** users can create, list, update, delete, and test channels, with secrets handled correctly.

**Tasks**
1. `modules/channels/`: schemas, service, and routes per PRD 10.5.
2. URL validation per PRD 7.4: `assertPublicUrl`, `https://` required in production, plus the Slack and Discord host and path rules. Reuse the V1 SSRF code. Do not write a second validator.
3. Encrypt targets and signing secrets with `encrypt()`. Generate the webhook signing secret (`whsec_` plus 32 random bytes, base64url) and return it only in the create response.
4. Return `maskedTarget` only. No endpoint ever returns a full URL or a stored secret.
5. `availableTypes` from config (`email` only when `EMAIL_PROVIDER` is set).
6. `POST /api/channels/:id/test` inserts a `test` notification and returns 202. Rate limits per PRD 10.9. Error codes per 10.7.
7. Tests (PRD 16 item 8).

**Verify**
```bash
# create a Discord channel with a real webhook URL
curl -X POST -H "authorization: Bearer $T" -H "content-type: application/json" \
  -d '{"type":"discord","name":"Test","url":"https://discord.com/api/webhooks/ID/TOKEN"}' localhost:8080/api/channels
# response has maskedTarget and no full URL
curl -H "authorization: Bearer $T" localhost:8080/api/channels
# bad hosts are rejected:
#   {"type":"slack","name":"x","url":"https://example.com/hook"}      -> 400
#   {"type":"webhook","name":"x","url":"http://127.0.0.1:9000"}       -> 400 URL_NOT_ALLOWED
# the database holds ciphertext:
#   select target_encrypted from notification_channels;               -> starts with v1:
```
Also confirm no log line contains the URL (search the terminal output for the token part).

**Commit:** `step 7: channels api`

---

## Step 8: The notifier

**Goal:** queued notifications are delivered, retried, suppressed, and recovered correctly.

**Tasks**
1. Add `notifier` to the roles (`roles.ts`, config, `dev:notifier` script using `cross-env`) and to graceful shutdown.
2. `src/notifier/notifier.ts`: the non-overlapping loop, the atomic claim query, and the per-notification order in PRD 7.7 (channel check, resolved pairing, cooldown with fail-open, hourly cap, send, outcome).
3. `src/notifier/render.ts`: message rendering per PRD 7.2 (titles, bodies, colors, escaping, duration format).
4. `src/notifier/adapters/`: `slack.ts`, `discord.ts` (embed, `allowed_mentions`), `webhook.ts` (headers and signature per PRD 7.3). Each sends through the SSRF-safe agent from V1, without following redirects, with the `NOTIFY_TIMEOUT_MS` timeout.
5. `src/notifier/deliver.ts`: map the result to the outcome rules (retry, permanent failure, `Retry-After`, backoff list, max attempts) and store only a short sanitized `last_error`.
6. Make the clock and the HTTP sender injectable so tests do not wait.
7. Tests: PRD 16 items 3, 4, and 7. The cooldown test needs Redis, so it belongs to `test:integration`.

**Verify**
```bash
npm test -- notifier
# End to end, with a channel pointing at a Discord webhook or a request-capture URL:
npm run dev                           # all four roles
# Press "Send test" via the API:
curl -X POST -H "authorization: Bearer $T" localhost:8080/api/channels/<id>/test
# The message arrives within about 5 s. Then:
select type, status, attempts, last_error, sent_at from notifications order by created_at desc limit 5;
```
Failure checks:
```sql
-- Retry: update the channel URL to an endpoint that returns 503, send a test, then watch attempts climb:
select attempts, status, next_attempt_at, last_error from notifications order by created_at desc limit 1;
```
Crash recovery: run the notifier in its own terminal (`npm run dev:notifier`), create a notification, stop the notifier immediately, wait over a minute, restart it. The notification is delivered exactly once.

📖 Read the claim query and `deliver.ts`. Be able to explain `FOR UPDATE SKIP LOCKED`, why `locked_until` exists, and which failures retry and which do not.

**Commit:** `step 8: notifier`

---

## Step 9: Email channel (Should)

**Goal:** email alerts work when a provider is configured, and the app is fine without one.

**Tasks**
1. `adapters/email.ts` per PRD 7.6: HTTPS call with `fetch` and a 10 second timeout, the recipient is always the user's account email (look it up at send time), a plain text body and an escaped HTML body.
2. `EMAIL_PROVIDER=none` behavior: `email` is missing from `availableTypes`, and creating an email channel returns `400 CHANNEL_TYPE_UNAVAILABLE`.
3. Tests with a fake provider endpoint (success, 429, 5xx, 4xx).

**Verify**
- With `EMAIL_PROVIDER=none`, the Add channel dialog (Step 13) will not offer email, and the API returns the error above.
- With a real provider key, an email channel's test notification arrives at your own account email. Check the provider's current rules for sender domains (some only let you send to the account owner until a domain is verified). If it cannot work for other users, say so in the README.

**Skip this step** if you are short on time. Nothing else depends on it.

**Commit:** `step 9: email channel`

---

## Step 10: Analytics

**Goal:** percentile stats and a time series, cached safely.

**Tasks**
1. `modules/analytics/analytics.service.ts`: the extended stats query (`percentile_cont ... FILTER` over successful checks only, plus min, max, average, counts, uptime) and the timeseries query (`date_bin`, bucket size by window) per PRD section 8.
2. Routes: extend `GET /api/monitors/:id/stats` and add `GET /api/monitors/:id/timeseries`. **Ownership check first, then the cache.**
3. Redis read-through cache with `STATS_CACHE_TTL_SECONDS` and swallowed Redis errors (PRD 8.3).
4. Tests (PRD 16 item 9) with a fixed dataset so the expected percentiles are known numbers.

**Verify**
```bash
curl -H "authorization: Bearer $T" "localhost:8080/api/monitors/$ID/stats?window=24h"
curl -H "authorization: Bearer $T" "localhost:8080/api/monitors/$ID/timeseries?window=7d"
```
Cross-check one number by hand in SQL:
```sql
select percentile_cont(0.95) within group (order by response_time_ms)
from check_results
where monitor_id = '<id>' and status = 'up' and response_time_ms is not null
  and checked_at >= now() - interval '24 hours';
```
It must match the API's `p95ResponseTimeMs` (rounded). Call the endpoint twice quickly and confirm the second call is served from Redis (`redis-cli --scan --pattern "watcher:cache:*"`).

**Commit:** `step 10: analytics`

---

## Step 11: Frontend: navigation, incident banner, incidents page

**Goal:** incidents are visible in the UI.

**Tasks** (follow `design.md`, and apply the additions in PRD 12.5 to `design.md` first)
1. Top bar links (Monitors, Incidents, Settings) with the current-page underline. Mobile menu under 640px. Footer link to `/api/docs`.
2. Routes `/incidents` and `/settings` (the settings page is a placeholder until Step 13).
3. `api/incidents.ts` with types. `IncidentBanner` on the dashboard (PRD 12.2), polling every 15 seconds. "Incident" pill on monitor cards that have `openIncident`.
4. `pages/Incidents.tsx` per PRD 12.4: segmented filter, clay panel with flat rows, orbs, durations, "Load more", empty states.

**Verify (manual checklist)**
- [ ] Banner appears only while an incident is open and disappears after it resolves.
- [ ] Incidents page shows open and resolved incidents with correct durations, and the filter works.
- [ ] Rows are keyboard focusable, with a visible focus ring.
- [ ] Looks right at 360px width. Nav collapses into a menu.
- [ ] Copy matches the PRD tables exactly (sentence case).

**Commit:** `step 11: frontend incidents`

---

## Step 12: Frontend: monitor detail analytics and alert settings

**Goal:** the detail page becomes the showpiece.

**Tasks**
1. Stats: extend the tiles (PRD 12.3), with en dashes for `null`.
2. `UptimeBar` from the timeseries data, with gap filling, colors per PRD 12.5, tooltip, hidden text summary.
3. `LatencyChart` driven by the timeseries: average line plus dashed p95 line, text legend, failed-bucket markers, `isAnimationActive={false}` under reduced motion.
4. Open incident notice under the header.
5. Incidents panel for this monitor (last 10).
6. Edit modal: the "Alerts" section with the toggle and two selects (PRD 12.3).
7. Lazy-load the detail page (and the chart library) with `React.lazy` to shrink the main bundle (V2's build warned about a 794 KB chunk).

**Verify (manual checklist)**
- [ ] Switching 24h and 7d updates every part of the page.
- [ ] Uptime bar matches reality: a failed period shows red, a gap shows grey.
- [ ] Both chart lines render, and the legend is text, not color only.
- [ ] Changing thresholds in the edit modal persists, and an invalid combination shows an inline error.
- [ ] `npm run build` shows a smaller initial chunk than before.

**Commit:** `step 12: frontend monitor analytics`

---

## Step 13: Frontend: settings (channels and history)

**Goal:** users can manage alerting from the UI.

**Tasks**
1. `api/channels.ts` and `api/notifications.ts` with types.
2. `ChannelCard`, `ChannelForm` (type select limited to `availableTypes`, URL field hidden for email), the one-time signing secret dialog with a Copy button ("Copied" for 2 seconds, `aria-live`), the delete confirm, the active toggle, and "Send test".
3. `NotificationTable` with the pill mapping from PRD 12.5, tooltips for the last error, and polling (10 seconds while any row is pending or sending, otherwise 60).
4. Map server errors inline: `URL_NOT_ALLOWED`, `CHANNEL_LIMIT_REACHED`, `CHANNEL_TYPE_UNAVAILABLE`. Use the copy table in PRD 12.4.
5. Leave a clearly marked slot for the API keys panel (Step 15).

**Verify (manual checklist)**
- [ ] Add a Discord or Slack channel, press "Send test", and watch the history row move from Pending to Sent.
- [ ] A webhook channel shows the signing secret once, and it is not retrievable afterward.
- [ ] The full webhook URL is never visible anywhere in the UI or in the network responses (check DevTools, Network).
- [ ] Deleting a channel keeps its past notifications in the history.
- [ ] Keyboard-only walkthrough works for add, test, and delete.

**Commit:** `step 13: frontend settings`

---

## Step 14: OpenAPI and Swagger UI

**Goal:** the API documents itself from the same schemas it validates with.

**Tasks**
1. `src/docs/registry.ts` and `openapi.ts`: register every route (V1, V2, V3, and `/health`) with request and response schemas from the existing zod schemas. Describe the error format, all error codes, both security schemes, the overview text, and the notes from PRD section 11 (including that percentiles use successful checks only).
2. `GET /api/openapi.json` and `GET /api/docs` with `swagger-ui-express`.
3. Relax the Content Security Policy for `/api/docs` **only**.
4. Tags per PRD section 11.
5. `tests/openapi.test.ts` per PRD 16 item 10.

**Verify**
- `http://localhost:8080/api/docs` loads. Click **Authorize**, paste a bearer token from a login response, and run **Try it out** on `GET /api/monitors`.
- `curl -I localhost:8080/api/monitors` still shows the strict CSP, while the docs page shows the relaxed one.
- `npm test -- openapi` passes, and the spec validates.
- Through the web container at `http://localhost:3000/api/docs`, the docs also load (the proxy covers `/api/`).

📖 Skim how one route is registered. Be able to explain why generating the spec from the zod schemas prevents the docs from drifting.

**Commit:** `step 14: openapi and swagger ui`

---

## Step 15: API keys (Stretch)

**Goal:** scripts can authenticate without a browser login.

**Skip this step** if you are short on time. Nothing else depends on it.

**Tasks**
1. Add migration `1700000000010_create-api-keys.sql` (PRD 4.5) and run it.
2. `modules/apiKeys/`: create, list, and revoke per PRD section 9. Generate `wk_` plus 32 random bytes (base64url), store only the SHA-256 hash and the 8-character prefix, return the full key once.
3. `middleware/auth.ts`: if `X-API-Key` is present, authenticate with it (hash, look up, reject revoked, update `last_used_at` at most once a minute). Otherwise use the JWT path. Reject key authentication on `/api/auth/*` and `/api/api-keys*` (those need a JWT).
4. Register `apiKeyAuth` in the OpenAPI spec.
5. Frontend: the API keys panel in Settings (list, create with one-time display and Copy, revoke) and the `X-API-Key` usage example.
6. Tests (PRD 16 item 11).

**Verify**
```bash
# create a key in the UI, then:
curl -H "X-API-Key: wk_..." localhost:8080/api/monitors          # 200
curl -H "X-API-Key: wk_..." localhost:8080/api/api-keys          # 401 (keys cannot manage keys)
# revoke it in the UI:
curl -H "X-API-Key: wk_..." localhost:8080/api/monitors          # 401
# the database holds only a hash:
select key_prefix, key_hash from api_keys;
```

**Commit:** `step 15: api keys`

---

## Step 16: Retention, Compose, and housekeeping

**Goal:** the full stack runs with the notifier, and old data is cleaned up.

**Tasks**
1. Retention job per PRD 14.4: notifications, resolved incidents, and expired or revoked refresh tokens, in batches, never touching open incidents. Test it (PRD 16 item 12).
2. `docker-compose.yml`: add a `notifier` service (same pattern as `consumer`, `ROLES: notifier`), and add to the shared environment block: `ENCRYPTION_KEY` (a local development value), `APP_PUBLIC_URL: http://localhost:3000`, and the notifier variables with their defaults.
3. Make sure the `api` role's `ROLES` in Compose still lists only `api`, and add the new env vars the API needs (`ENCRYPTION_KEY`).
4. `docker compose up --build` from a clean checkout still works.

**Verify**
```bash
docker compose down -v
docker compose up --build
# open http://localhost:3000, register, create a channel, send a test, confirm it arrives
docker compose logs notifier | tail
```

**Commit:** `step 16: retention and compose`

---

## Step 17: End-to-end verification and deploy

### 17.1 Local end-to-end (PRD acceptance criteria 1 to 11 and 14)
With the Compose stack running, create a real Discord (easiest) or Slack channel, plus a generic webhook pointed at a request-capture URL. Then:

**A. Incident opens once.** Add a monitor for `https://example.com`, interval 60 seconds, thresholds 3 and 2. Edit its expected status code to `418` so it fails. After about 3 minutes:
```sql
select id, started_at, failed_checks from incidents;                 -- one open incident
select type, status, channel_name from notifications order by created_at;   -- one "incident.opened" per channel
```
The dashboard banner shows "1 incident open". Wait two more checks: no extra notifications.

**B. Incident resolves once.** Change the expected status back to `200`. After 2 successful checks the incident has a `resolved_at`, each channel gets one "recovered" message, and `/incidents` shows the duration.

**C. Flapping and cooldown.** Toggle the expected status between `418` and `200` quickly (each change has to survive threshold checks, so lower both thresholds to 1 for this test). The history shows `suppressed` entries with the cooldown reason.

**D. Retries.** Point a webhook channel at a URL that returns 503. Attempts climb with the backoff, then **Failed**. A 404 target fails on attempt 1.

**E. Crash recovery.** `docker compose stop notifier`, open an incident, `docker compose start notifier`. Pending messages arrive once.

**F. Redis down.** `docker compose stop redis`, open an incident. Alerts still send. `docker compose start redis`.

**G. Secrets.** `select target_encrypted from notification_channels;` shows `v1:` ciphertext. Search `docker compose logs` for part of a webhook URL: nothing.

**H. V2 regression.** Re-run the V2 scenarios (catch-up, poison message, Kafka outage, two schedulers) quickly to confirm nothing broke.

### 17.2 Deploy
1. **Render:** add the V3 variables: `ROLES=api,scheduler,consumer,notifier`, a **new** `ENCRYPTION_KEY` (generate it, and **back it up somewhere safe**), `APP_PUBLIC_URL` (your Vercel URL), the notifier variables, and `RESULT_RETENTION_DAYS=8`. Add `EMAIL_PROVIDER` variables only if you did Step 9. Redeploy and read the logs: migrations 6 to 10, Redis and queue connected, all four roles started.
2. **Vercel:** no changes. Confirm `https://<app>.vercel.app/api/docs` loads.
3. **GitHub:** merge the pull request once CI is green, and enable auto-deploy-after-CI on Render and Vercel if the option exists.
4. **Production check:** create a real Discord or Slack channel on the deployed app, press "Send test", then repeat scenarios A and B on production (this takes about 6 minutes). Remember that a sleeping Render instance pauses checking, so keep the app open or ping `/health` while you test.

**Commit:** `step 17: v3 verified and deployed`

---

## Step 18: README, screenshots, and the tag

**Tasks**
1. Write the README to PRD 14.5. It is the first thing a recruiter reads, so give it real time.
2. Capture the screenshots or a GIF: dashboard, monitor detail (stats, uptime bar, chart), an open incident, the settings page, the Pipeline card, and the Discord or Slack message that arrived.
3. Add the final architecture Mermaid diagram (PRD 3.1) and the failure behavior table.
4. Copy `PRD-v3.md` and `implementation-v3.md` into `docs/`, and append the design additions (PRD 12.5) to `design.md`.
5. Add the live links: the Vercel app and the API docs.

**Commit and tag**
```bash
git add -A && git commit -m "v3: alerting, incidents, analytics, docs, ci"
git checkout main && git merge v3
git tag v3 && git push origin main --tags
```

---

## Step 19: Final acceptance and interview prep

Go through PRD-v3 section 18 line by line. Local criteria 1 to 14, then CI and production criteria 15 to 18.

**Interview-prep list.** You should be able to explain these without looking:
1. What the transactional outbox pattern is, and what failure it prevents (the dual-write gap between Postgres and a queue).
2. Why V3 uses an outbox instead of a second Kafka consumer group for alerts.
3. Thresholds and hysteresis: why 3 failures to open and 2 successes to close, and what flapping looks like without them.
4. What the cooldown does that thresholds cannot, and why suppressed alerts are stored instead of dropped.
5. How duplicates are prevented at three levels: the event ID, the unique notification index, and the one-open-incident index.
6. How the notifier stays correct with several instances (`SKIP LOCKED`) and after a crash (`locked_until`).
7. Which delivery failures retry and which are permanent, and why a 404 should not be retried.
8. Why outbound webhooks need SSRF protection, and how connect-time checking handles DNS changes.
9. How secrets are protected: AES-GCM encryption at rest, masked in responses, redacted in logs, signed outbound webhooks with replay protection.
10. How `percentile_cont` and `date_bin` work, and why percentiles are computed over successful checks only.
11. How the OpenAPI spec stays in sync with validation, and why only the docs route gets a relaxed CSP.
12. What the CI pipeline checks, and why Kafka integration tests run there too.
13. The honest limitations: free-tier sleep pauses all roles, the incident duration caveat, 8 days of raw data, no maintenance windows.

---

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Boot fails with an `ENCRYPTION_KEY` error | The key must be base64 of exactly 32 bytes. Regenerate it with the command in Step 4. |
| Channel URLs stop decrypting after a redeploy | `ENCRYPTION_KEY` changed. Restore the old key, or have users re-enter their channels. |
| Incident never opens | Thresholds not reached (check `failure_threshold`), `applied` was false (late event), or the consumer is not running. Check `consecutive_failures` on the monitor row. |
| Two incidents for one outage | The partial unique index is missing or the open-incident lookup is not using `FOR UPDATE`. Check migration 7. |
| Notification stays `pending` forever | The `notifier` role is not running (check `ROLES`), or `next_attempt_at` is in the future after a retry. |
| Notification stuck in `sending` | The notifier crashed mid-send. It is reclaimed after `locked_until` (60 seconds). |
| Every alert is `suppressed` | The cooldown key already exists. Wait `ALERT_COOLDOWN_SECONDS`, or `redis-cli del` the key while testing. |
| Discord or Slack returns 404 or 401 | The webhook was deleted or the URL is wrong. Permanent failures are expected here. Recreate the webhook. |
| Webhook creation says `URL_NOT_ALLOWED` for a public URL | DNS resolves to a private address, or the URL is `http://` in production. Use `https://`. |
| Email channel unavailable | `EMAIL_PROVIDER` is `none`, or the provider variables are missing. Expected behavior. |
| Emails work locally but not on Render | You are using SMTP. Free Render services block SMTP ports. Use the HTTPS email adapter. |
| `/api/docs` is blank | Content Security Policy blocking the page. The relaxed policy must apply to the docs route only, and the route must be registered before the strict default. |
| Stats are stale for about 30 seconds | The Redis cache TTL. Expected. |
| p95 differs from your SQL check | You filtered differently. The API uses `status = 'up'` with a non-null response time, over the same window. |
| CI fails only on Kafka tests | The Kafka service did not become healthy in time. Increase `--wait-timeout` or check the container logs in the Actions run. |
| CI passes locally but fails on formatting | Run `npm run format` in both packages and commit the result. |
| Main bundle is still large | Make sure the detail page and `recharts` are loaded with `React.lazy` and that nothing imports them eagerly. |
