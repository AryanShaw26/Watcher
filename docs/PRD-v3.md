# Watcher: Product Requirements Document (Version 3)

> **Your APIs. Always in Sight.**

| | |
|---|---|
| **Product** | Watcher, an API uptime and latency monitor |
| **Version** | 3.0 ("Final product") |
| **Builds on** | Version 2 (`PRD-v2.md`, tagged `v2`) and Version 1 (`PRD.md`) |
| **Styling** | `design.md` (extended in section 12.5) |
| **Companion doc** | `implementation-v3.md` |

> **Agent instructions:** This document describes **only what changes from Version 2**. Everything in `PRD.md` and `PRD-v2.md` still applies unless this document says otherwise (auth, monitors CRUD, SSRF protection, error format, the queue pipeline, design). Use the names, tables, keys, routes, and env vars in this file verbatim. Respect the **priority labels** in section 1.3: build Must items first, then Should, and treat Stretch items as optional. Do not add features outside this document (for example public status pages, teams, or SSO). If something is ambiguous, choose the simplest option that satisfies the acceptance criteria and note it in the README.

---

## 1. Overview

Versions 1 and 2 collect checks and store them reliably. Version 3 makes Watcher **useful and finished**: it tells people when something breaks, tracks outages as incidents, shows real latency analytics, documents its own API, and ships with a CI pipeline and a polished README.

### 1.1 Goals
1. **Incidents:** an outage is recorded as an incident that opens after N consecutive failed checks and resolves after M consecutive successful checks.
2. **Alerting:** opening and resolving an incident sends notifications to the user's channels (Slack, Discord, signed generic webhook, and optionally email), with retries, a cooldown against flapping, and a visible history.
3. **Analytics:** per-monitor uptime, average, minimum, maximum, **p50, p95, and p99** latency, and a time series for charts and an uptime bar.
4. **API documentation:** an OpenAPI spec generated from the same zod schemas the API validates with, served with Swagger UI.
5. **API keys** so scripts can call the API without a browser login (Stretch).
6. **Quality:** working lint and formatting, request IDs, a GitHub Actions pipeline, dependency scanning, and a README that sells the project.
7. Keep everything from V1 and V2 working, including the failure behavior from the V2 acceptance criteria.

### 1.2 Non-Goals (still out of scope)
- Public status pages, teams, roles, SSO, and billing
- SMS, phone, and push notifications, and reminder or escalation policies
- Maintenance windows and scheduled downtime
- Multi-region checks, custom request headers or bodies for checks
- A metrics stack (Prometheus, Grafana) and distributed tracing
- Long-term rollups (raw results are still kept for a short, configurable window)

### 1.3 Priorities

| Priority | Items |
|---|---|
| **Must** | Incidents, alerting for Slack, Discord, and generic webhook, analytics (p50 and p95 and time series), dashboard and settings UI, OpenAPI docs, lint and CI, README |
| **Should** | Email channel, p99 and min and max in stats, stats caching in Redis, retention for the new tables, request IDs, audit-level dependency scanning |
| **Stretch** | API keys (section 9) |

If you run short on time, cut Stretch first, then Should. Never cut anything that would leave a Must item half-built.

### 1.4 What changes from V2 at a glance

| Area | V2 | V3 |
|---|---|---|
| Outage handling | Raw status per check | Incidents with thresholds and duration |
| Notifications | None | Outbox table plus a `notifier` role with retries, cooldown, and history |
| Stats | Uptime, average | Plus min, max, p50, p95, p99, and a time series |
| Roles | `api`, `scheduler`, `consumer` | Plus `notifier` |
| API docs | None | OpenAPI and Swagger UI at `/api/docs` |
| Auth | JWT login | Plus API keys (Stretch) |
| Quality | Tests only | Lint, format, CI, dependency scanning, request IDs |
| Secrets | Env only | Plus encryption of stored webhook URLs and signing secrets |

---

## 2. Tech Stack Additions

| Concern | Choice |
|---|---|
| OpenAPI generation | `@asteasolutions/zod-to-openapi` (spec built from zod schemas) |
| API docs UI | `swagger-ui-express` |
| OpenAPI validation in tests | `@apidevtools/swagger-parser` (dev) |
| Encryption at rest | Node `crypto`, AES-256-GCM (no new package) |
| Webhook signing | Node `crypto`, HMAC-SHA-256 (no new package) |
| Email (optional) | **Resend HTTPS API** through `fetch` (no SMTP, no SDK) |
| Lint | `eslint` (flat config), `typescript-eslint`, `@eslint/js`, `eslint-config-prettier` |
| Format | `prettier` |
| Frontend charts | `recharts` (already installed) |
| CI | GitHub Actions |
| Dependency updates | Dependabot |

> **Why email uses an HTTPS API:** free Render web services block outbound SMTP on ports 25, 465, and 587, so Nodemailer-style SMTP would silently fail in production. An HTTPS email API works from the free tier. Confirm the provider's current free-tier limits and sender-domain rules before you rely on it (some providers only let you send to your own address until you verify a domain). Because of this, email is a **Should** item and the app must work fully without it.

---

## 3. System Architecture

### 3.1 Diagram

```mermaid
flowchart LR
    SCH[scheduler role] -->|publish| K[[Kafka / Redis Streams: check.results]]
    K --> CON[consumer role]

    subgraph TX[One Postgres transaction]
        direction TB
        R1[insert check_results] --> R2[update monitor state] --> R3[open or resolve incident] --> R4[insert notifications rows - the outbox]
    end
    CON --> TX

    TX --> PG[(Postgres / Neon)]
    NOT[notifier role] -->|claim pending, SKIP LOCKED| PG
    NOT -->|cooldown, SET NX| RD[(Redis)]
    NOT -->|Slack| S[Slack webhook]
    NOT -->|Discord| D[Discord webhook]
    NOT -->|signed JSON| W[Generic webhook]
    NOT -->|HTTPS API| E[Email provider]

    API[api role] --> PG
    API -->|stats cache| RD
    UI[React dashboard] --> API
    DOCS[/api/docs/] --- API
```

### 3.2 Roles
`ROLES` now accepts four names: `api`, `scheduler`, `consumer`, `notifier`.

| Role | New in V3 | Does |
|---|---|---|
| `notifier` | Yes | Claims pending rows from `notifications`, delivers them, retries with backoff, applies the cooldown and caps |

Locally, `notifier` is its own container. On Render's free tier, production runs `ROLES=api,scheduler,consumer,notifier` in one process.

### 3.3 Flow of one alert

1. The consumer stores a check result through `recordResult(event)` (V2).
2. In the **same transaction**, the incident engine (section 6) may open or resolve an incident.
3. In the same transaction, it inserts one `notifications` row per active channel of the monitor's owner (the **outbox**).
4. The transaction commits. Either everything above happened, or none of it did.
5. The notifier claims due rows, checks the cooldown and caps, sends them, and records the outcome.
6. The dashboard shows the incident immediately (it is in Postgres) and the notification status as it progresses.

### 3.4 Design decisions to explain in the README

**Transactional outbox instead of publishing alerts to a queue.**
Writing the incident to Postgres and then publishing a message to Kafka are two separate writes. If the process crashed between them, you would get an incident with no alert, or an alert with no incident. Putting the notification rows in the same transaction as the incident removes that gap, and the notifier delivers them at least once.

**Deviation from the V2 forward-compatibility note.**
`PRD-v2.md` suggested a second Kafka consumer group for alerts. V3 deliberately does not use one, because incident state must be consistent with the stored result, and two independent consumers racing on the same monitor's streak counters would need extra coordination. The Kafka topic stays available for future independent consumers (for example analytics).

**Thresholds instead of alerting on one failure.**
A single failed check is often a blip. An incident opens only after `failure_threshold` consecutive failures (default 3) and resolves only after `recovery_threshold` consecutive successes (default 2). The different thresholds add hysteresis so a flapping endpoint does not open and close incidents constantly. The dashboard badge still shows the raw status of the latest check (V1 behavior). The incident is the *confirmed* outage.

**Cooldown instead of silence.**
Even with thresholds, a monitor can flap across many short incidents. The notifier uses a Redis cooldown per monitor and channel (default 10 minutes). Notifications inside the cooldown are not dropped silently: they are stored with status `suppressed` and a reason, so the history shows what happened.

**Duplicates are impossible by construction.**
A unique index on `(incident_id, channel_id, type)` guarantees at most one "opened" and one "resolved" notification per channel per incident, even if the consumer reprocesses an event.

**Outbound requests are as dangerous as inbound ones.**
Webhook URLs are user-supplied, so every delivery goes through the same SSRF protections as the checker (V1 section 6.4). Slack and Discord URLs are additionally restricted to their official hosts.

---

## 4. Database Changes

All migrations go through the project's migration script (it records them in `pgmigrations`). Do not apply them by hand. File names continue the V1 and V2 numbering.

### 4.1 `1700000000006_add-monitor-alert-settings.sql`
```sql
-- Up Migration
ALTER TABLE monitors
  ADD COLUMN failure_threshold         integer     NOT NULL DEFAULT 3 CHECK (failure_threshold BETWEEN 1 AND 10),
  ADD COLUMN recovery_threshold        integer     NOT NULL DEFAULT 2 CHECK (recovery_threshold BETWEEN 1 AND 10),
  ADD COLUMN alerts_enabled            boolean     NOT NULL DEFAULT true,
  ADD COLUMN consecutive_successes     integer     NOT NULL DEFAULT 0,
  ADD COLUMN failure_streak_started_at timestamptz;

-- Down Migration
ALTER TABLE monitors
  DROP COLUMN failure_streak_started_at,
  DROP COLUMN consecutive_successes,
  DROP COLUMN alerts_enabled,
  DROP COLUMN recovery_threshold,
  DROP COLUMN failure_threshold;
```

### 4.2 `1700000000007_create-incidents.sql`
```sql
-- Up Migration
CREATE TABLE incidents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor_id       uuid        NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  started_at       timestamptz NOT NULL,
  resolved_at      timestamptz,
  failed_checks    integer     NOT NULL DEFAULT 0,
  opened_error     text,
  last_error       text,
  last_status_code integer,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT incidents_resolved_after_start CHECK (resolved_at IS NULL OR resolved_at >= started_at)
);
-- at most one open incident per monitor
CREATE UNIQUE INDEX incidents_one_open_per_monitor ON incidents (monitor_id) WHERE resolved_at IS NULL;
CREATE INDEX incidents_monitor_started_idx ON incidents (monitor_id, started_at DESC);
CREATE INDEX incidents_started_idx         ON incidents (started_at DESC);

-- Down Migration
DROP TABLE incidents;
```

### 4.3 `1700000000008_create-notification-channels.sql`
```sql
-- Up Migration
CREATE TABLE notification_channels (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type                      text         NOT NULL CHECK (type IN ('webhook','slack','discord','email')),
  name                      varchar(100) NOT NULL,
  target_encrypted          text,        -- AES-256-GCM of the URL (null for email)
  signing_secret_encrypted  text,        -- AES-256-GCM of the HMAC secret (webhook only)
  is_active                 boolean      NOT NULL DEFAULT true,
  created_at                timestamptz  NOT NULL DEFAULT now(),
  updated_at                timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX notification_channels_user_idx ON notification_channels (user_id);

-- Down Migration
DROP TABLE notification_channels;
```

### 4.4 `1700000000009_create-notifications.sql`
```sql
-- Up Migration
CREATE TABLE notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id      uuid        REFERENCES notification_channels(id) ON DELETE SET NULL,
  channel_type    text        NOT NULL,
  channel_name    text        NOT NULL,
  monitor_id      uuid        REFERENCES monitors(id) ON DELETE SET NULL,
  incident_id     uuid        REFERENCES incidents(id) ON DELETE SET NULL,
  type            text        NOT NULL CHECK (type IN ('incident.opened','incident.resolved','test')),
  payload         jsonb       NOT NULL,
  status          text        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','sending','sent','failed','suppressed')),
  attempts        integer     NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until    timestamptz,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz
);
CREATE INDEX notifications_due_idx ON notifications (next_attempt_at) WHERE status IN ('pending','sending');
CREATE INDEX notifications_user_created_idx ON notifications (user_id, created_at DESC);
-- at most one notification of each type per incident per channel
CREATE UNIQUE INDEX notifications_dedupe_uq ON notifications (incident_id, channel_id, type)
  WHERE incident_id IS NOT NULL AND channel_id IS NOT NULL;

-- Down Migration
DROP TABLE notifications;
```

### 4.5 `1700000000010_create-api-keys.sql` (Stretch)
```sql
-- Up Migration
CREATE TABLE api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         varchar(100) NOT NULL,
  key_prefix   text         NOT NULL,         -- first 8 characters, shown in the UI
  key_hash     text         NOT NULL UNIQUE,  -- SHA-256 hex of the full key
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX api_keys_user_idx ON api_keys (user_id);

-- Down Migration
DROP TABLE api_keys;
```

### 4.6 Data rules
- Webhook URLs and signing secrets are **never stored in plain text** (section 7.5) and never returned by the API after creation.
- `notifications.payload` holds the data needed to render the message (monitor name and URL, incident times, error, status code) so history stays accurate even if the monitor is later renamed or deleted. It must contain **no secrets**.
- Deleting a channel keeps its notification history (`channel_id` becomes null, `channel_name` and `channel_type` remain).
- `monitors.consecutive_failures` and `consecutive_successes` are mutually exclusive: one of them is always 0.
- Existing monitors get the defaults (threshold 3, recovery 2, alerts on). Existing rows need no backfill.

---

## 5. Changes to Result Recording

`recordResult(event)` (V2, `src/modules/results/result.service.ts`) gains the incident engine. Its signature and the duplicate and out-of-order rules are unchanged. The return type becomes:

```ts
{
  inserted: boolean;
  applied: boolean;
  previousStatus: 'pending' | 'up' | 'down' | null;
  incident: { action: 'opened' | 'resolved' | 'updated'; id: string } | null;
}
```

The monitor `UPDATE` (step 3 of V2's function) now also maintains the streak columns:

```sql
UPDATE monitors SET
  current_status            = $status,
  last_checked_at           = $checkedAt,
  last_response_time_ms     = $rt,
  last_status_code          = $code,
  last_error                = $err,
  consecutive_failures      = CASE WHEN $status = 'up' THEN 0 ELSE consecutive_failures + 1 END,
  consecutive_successes     = CASE WHEN $status = 'up' THEN consecutive_successes + 1 ELSE 0 END,
  failure_streak_started_at = CASE WHEN $status = 'up' THEN NULL
                                   WHEN consecutive_failures = 0 THEN $checkedAt
                                   ELSE failure_streak_started_at END,
  updated_at                = now()
WHERE id = $1 AND (last_checked_at IS NULL OR last_checked_at <= $checkedAt)
RETURNING *;
```
(In a SQL `UPDATE`, the right-hand side sees the **old** row values, which is why `consecutive_failures = 0` correctly means "the previous check was not a failure".)

The incident engine (section 6) runs only when `applied` is true, inside the same transaction. Manual checks (`source: "manual"`) count like any other check.

---

## 6. Incident Engine

### 6.1 Rules
Evaluated after a successful, applied monitor update, using the **updated** monitor row.

| Condition | Action |
|---|---|
| Result is `down`, an incident is open | Update the incident: `failed_checks = failed_checks + 1`, `last_error`, `last_status_code`. Return `updated`. |
| Result is `down`, no open incident, `consecutive_failures >= failure_threshold` | Insert an incident: `started_at = failure_streak_started_at`, `failed_checks = consecutive_failures`, `opened_error` and `last_error` = this check's error, `last_status_code`. Enqueue `incident.opened` notifications. Return `opened`. |
| Result is `down`, no open incident, below threshold | Nothing |
| Result is `up`, an incident is open, `consecutive_successes >= recovery_threshold` | Set `resolved_at = checkedAt`. Enqueue `incident.resolved` notifications. Return `resolved`. |
| Result is `up`, an incident is open, below the recovery threshold | Nothing (the incident stays open) |
| Result is `up`, no open incident | Nothing |

- The open-incident lookup uses `SELECT ... FOR UPDATE`. The partial unique index is the final guard against two open incidents, so use `INSERT ... ON CONFLICT DO NOTHING` and treat "no row inserted" as `updated`.
- `started_at` is the time of the **first failed check in the streak**, which makes the duration honest. `resolved_at` is the time of the check that **confirmed** recovery, so a duration can overstate real downtime by up to `(recovery_threshold - 1)` check intervals. Document this in the README.
- If `alerts_enabled` is false for the monitor, the incident is still recorded but no notification rows are created.

### 6.2 Enqueueing notifications
For each channel where `user_id` matches the monitor's owner and `is_active` is true:

```sql
INSERT INTO notifications (user_id, channel_id, channel_type, channel_name, monitor_id, incident_id, type, payload)
VALUES (...)
ON CONFLICT (incident_id, channel_id, type) WHERE incident_id IS NOT NULL AND channel_id IS NOT NULL DO NOTHING;
```

Payload (the same object for every channel type):
```json
{
  "monitor": { "id": "uuid", "name": "Payments API", "url": "https://api.example.com/health" },
  "incident": { "id": "uuid", "startedAt": "ISO", "resolvedAt": null, "durationSeconds": null, "failedChecks": 3 },
  "check": { "statusCode": 503, "error": "Expected 200, got 503", "responseTimeMs": 412 },
  "createdAt": "ISO"
}
```
For `incident.resolved`, `resolvedAt` and `durationSeconds` are set and `check` describes the recovering check.

### 6.3 Scenarios the tests must cover
Thresholds are failure 3, recovery 2 unless stated.

| Sequence of results | Expected |
|---|---|
| down, down | No incident |
| down, down, down | Incident opens once. One notification per active channel. |
| down x 5 | Same single incident, `failed_checks = 5`, no new notifications |
| down x 3, up | Incident still open |
| down x 3, up, up | Incident resolved once. One resolved notification per channel. |
| down x 3, up, down, up, up | Incident stays open through the single success (the failure resets the recovery streak), resolves after two consecutive successes |
| down, up, down, up (flapping) | No incident ever opens |
| Same event delivered twice | No second incident, no second notification |
| Older event arriving late (`applied: false`) | No incident change |
| `alerts_enabled = false` | Incident recorded, zero notification rows |
| Channel inactive | No notification row for that channel |
| Failure threshold 1 | Opens on the first failure |

---

## 7. Notifications

### 7.1 Channel types

| Type | Target | Notes |
|---|---|---|
| `slack` | Incoming webhook URL. Host must be `hooks.slack.com`, path starts with `/services/` | Message uses `attachments` with a color and text |
| `discord` | Webhook URL. Host `discord.com` or `discordapp.com`, path starts with `/api/webhooks/` | Message uses one embed. `allowed_mentions` is `{ "parse": [] }` so no pings are possible. |
| `webhook` | Any public `https://` URL (see 7.4) | Signed JSON (7.3). A generated signing secret is shown **once** at creation. |
| `email` (Should) | The account email of the logged-in user. No address is accepted from the client. | Only available when `EMAIL_PROVIDER` is configured (7.6) |

Limits: `MAX_CHANNELS_PER_USER` (default 5).

### 7.2 Message content
Sentence case, no emoji required. Use the monitor name, never raw HTML.

| Event | Title | Body |
|---|---|---|
| `incident.opened` | `{monitor} is down` | `{url}` then `{error or "HTTP {code}"} after {failedChecks} failed checks.` then `Started {time} UTC.` then a link to `{APP_PUBLIC_URL}/incidents` |
| `incident.resolved` | `{monitor} recovered` | `{url}` then `Back up after {duration}.` then a link to `{APP_PUBLIC_URL}/incidents` |
| `test` | `Test notification from Watcher` | `This channel is set up correctly.` |

- Embed or attachment color: red `#D91E2B` for opened, yellow `#FFC83D` for resolved, orange `#FF7A1A` for test (the brand palette from `design.md`).
- **Escaping:** Slack text must escape `&`, `<`, and `>`. HTML email bodies must escape all dynamic values. The plain text alternative is always included.
- Durations render as `2 min`, `1 h 5 min`, or `45 s`.

### 7.3 Generic webhook format

```http
POST {url}
Content-Type: application/json
User-Agent: WatcherBot/1.0 (+uptime-monitor)
X-Watcher-Event: incident.opened
X-Watcher-Delivery: {notification id}
X-Watcher-Timestamp: {unix seconds}
X-Watcher-Signature: sha256={hex}
```
Body:
```json
{
  "event": "incident.opened",
  "deliveryId": "uuid",
  "sentAt": "ISO",
  "monitor": { "id": "uuid", "name": "...", "url": "..." },
  "incident": { "id": "uuid", "startedAt": "ISO", "resolvedAt": null, "durationSeconds": null, "failedChecks": 3 },
  "check": { "statusCode": 503, "error": "...", "responseTimeMs": 412 }
}
```
The signature is `HMAC-SHA256(signingSecret, timestamp + "." + rawBody)`, hex encoded. The README documents how a receiver verifies it, including rejecting timestamps older than 5 minutes (replay protection).

### 7.4 URL validation (create and update)
1. Apply the V1 SSRF validation (`assertPublicUrl`) to every channel URL.
2. `webhook` requires `https://` in production. `http://` is accepted only when `ALLOW_PRIVATE_TARGETS=true` (local development).
3. `slack` and `discord` apply their host and path rules (7.1) **in addition** to step 1.
4. Return `400 URL_NOT_ALLOWED` (or `400 VALIDATION_ERROR` for the host rules) with a clear message.
5. At **delivery time**, send through the SSRF-safe agent again (connect-time IP check), so DNS changes after creation cannot reach internal addresses.
6. Do not follow redirects.

### 7.5 Secrets at rest
- Algorithm: AES-256-GCM using `ENCRYPTION_KEY` (32 random bytes, base64). Random 12-byte IV per value.
- Stored format: `v1:` + base64(`iv` + `authTag` + `ciphertext`). The `v1:` prefix allows a future key rotation scheme.
- `src/lib/crypto.ts` exports `encrypt(plain)` and `decrypt(stored)`. `decrypt` throws on a wrong key, a tampered value, or an unknown version.
- The API **never** returns a stored URL or secret. Channel responses include `maskedTarget` only (host plus `/…` plus the last 4 characters of the path), for example `hooks.slack.com/…a1b2`. For email, a masked version of the account email.
- Never log URLs, secrets, payload bodies that contain targets, or the encryption key. Add `target`, `url` (inside channel objects), `signingSecret`, and `ENCRYPTION_KEY` to the pino redaction list.
- Boot validation: `ENCRYPTION_KEY` must decode to exactly 32 bytes whenever the `api` or `notifier` role is active.

### 7.6 Email (Should)
- `EMAIL_PROVIDER=none` (default) or `resend`. When `none`, creating an `email` channel returns `400 CHANNEL_TYPE_UNAVAILABLE`, and `GET /api/channels` omits `email` from `availableTypes`.
- The `resend` adapter calls the provider's HTTPS send endpoint with `fetch` (10 second timeout, bearer API key from `RESEND_API_KEY`, sender from `EMAIL_FROM`). The host is a constant in code, not user input.
- Recipient is always the user's account email. Subject: `[Watcher] {title}`.
- A 4xx from the provider (except 429) is a permanent failure. 429 and 5xx retry.

### 7.7 The notifier (`src/notifier/notifier.ts`)

**Loop:** every `NOTIFIER_TICK_SECONDS` (default 5), non-overlapping, only in the `notifier` role.

**Claim** (atomic, safe with several notifier instances):
```sql
UPDATE notifications
SET status = 'sending', attempts = attempts + 1, locked_until = now() + interval '60 seconds'
WHERE id IN (
  SELECT id FROM notifications
  WHERE (status = 'pending' AND next_attempt_at <= now())
     OR (status = 'sending' AND locked_until < now())      -- crash recovery
  ORDER BY next_attempt_at
  LIMIT $batch
  FOR UPDATE SKIP LOCKED
)
RETURNING *;
```
`$batch` is `NOTIFY_BATCH_SIZE` (default 20). Deliver with `p-limit(5)`.

**Per notification, in order:**
1. Load the channel. If it is missing or inactive, set `suppressed` with `last_error = "Channel removed or disabled"`.
2. **Resolved pairing:** for `incident.resolved`, send only if the matching `incident.opened` notification for the same channel has status `sent`. Otherwise `suppressed` with `"No alert was sent for the start of this incident"`.
3. **Cooldown** (`incident.opened` only): `SET {prefix}alert:cooldown:{monitorId}:{channelId} 1 NX EX ALERT_COOLDOWN_SECONDS`. If the key already exists, set `suppressed` with `"Within cooldown after a recent alert"`. If Redis is unreachable, **fail open** (send) and log a warning.
4. **Hourly cap:** count `sent` notifications for the channel (excluding `test`) in the last hour. If it is at or above `NOTIFY_MAX_PER_CHANNEL_PER_HOUR`, set `suppressed` with `"Hourly limit reached for this channel"`.
5. Decrypt the target, render the message for the channel type, and send with a `NOTIFY_TIMEOUT_MS` timeout through the SSRF-safe agent.
6. Record the outcome.

**Outcome rules**

| Result | Action |
|---|---|
| 2xx | `status = 'sent'`, `sent_at = now()`, clear `last_error` |
| 429 | Retry. Honor `Retry-After` (capped at 15 minutes). |
| 5xx, timeout, connection error | Retry with backoff |
| Other 4xx (400, 401, 403, 404, 410...) | **Permanent failure**: `status = 'failed'`, no retry |
| SSRF or URL rejection | Permanent failure |
| Decryption error | Permanent failure, logged at error level |

**Backoff:** after failure number `n`, `next_attempt_at = now() + NOTIFY_BACKOFF_SECONDS[n-1]` (default `30,120,600,1800`, the last value repeats), status back to `pending`. After `NOTIFY_MAX_ATTEMPTS` (default 5) total attempts, set `failed`. Store a short sanitized `last_error` such as `HTTP 503` or `Timeout after 10000ms` (never the response body, never the URL).

**Shutdown:** stop claiming, let in-flight sends finish (10 second cap). Any row still `sending` is reclaimed after its lock expires.

**Logging:** one line per attempt with `notificationId`, `type`, `channelType`, `status`, `attempt`. No targets.

### 7.8 Failure behavior

| Situation | Behavior |
|---|---|
| Notifier is down | Rows stay `pending`. When it returns, it sends them, in order of creation. Incidents are unaffected. |
| Redis is down | Cooldown fails open. Alerts still send. |
| Channel endpoint is down | Retries with backoff, then `failed`, visible in history |
| Postgres is down | Nothing is claimed or created. The consumer's retry and DLQ behavior from V2 applies. |
| Duplicate event | No duplicate notification (unique index) |

---

## 8. Analytics

### 8.1 `GET /api/monitors/:id/stats` (extended)
Query `window`: `24h` (default) or `7d`. Behavior is a superset of V1. Percentiles are computed **over successful checks that have a response time**, because the response time of a failed check (for example a timeout) would distort latency figures. Say so in the README and in the OpenAPI description.

```json
{
  "window": "24h",
  "totalChecks": 288,
  "failedChecks": 3,
  "uptimePercent": 98.96,
  "avgResponseTimeMs": 151,
  "minResponseTimeMs": 88,
  "maxResponseTimeMs": 612,
  "p50ResponseTimeMs": 140,
  "p95ResponseTimeMs": 290,
  "p99ResponseTimeMs": 480
}
```
All latency fields are integers (rounded) or `null` when there is no data. SQL uses ordered-set aggregates, for example:
```sql
percentile_cont(0.95) WITHIN GROUP (ORDER BY response_time_ms)
  FILTER (WHERE status = 'up' AND response_time_ms IS NOT NULL)
```

### 8.2 `GET /api/monitors/:id/timeseries`
Query `window`: `24h` (default) or `7d`. Buckets are `15 minutes` for `24h` (up to 96) and `2 hours` for `7d` (up to 84), returned as `bucketMinutes`.

```json
{
  "window": "24h",
  "bucketMinutes": 15,
  "buckets": [
    { "start": "2026-01-01T10:00:00.000Z", "total": 3, "failed": 0,
      "avgResponseTimeMs": 142, "p95ResponseTimeMs": 180 }
  ]
}
```
- Bucketing uses `date_bin(interval, checked_at, TIMESTAMPTZ '2000-01-01')` (Postgres 14 or newer, which covers local Postgres 16 and Neon).
- Only buckets that contain data are returned. The client fills gaps as "no data".
- `avgResponseTimeMs` and `p95ResponseTimeMs` are `null` for a bucket with no successful checks.

### 8.3 Caching
Both endpoints read through Redis: `{prefix}cache:stats:{monitorId}:{window}` and `{prefix}cache:series:{monitorId}:{window}`, JSON values, TTL `STATS_CACHE_TTL_SECONDS` (default 30). The **ownership check always happens first**, so a cached value is never returned to the wrong user. Redis errors are swallowed and the query runs against Postgres.

### 8.4 Retention interaction
Raw results are kept for `RESULT_RETENTION_DAYS`. The default is raised from 7 to **8** so a full `7d` window is always available. Stats and series only ever cover data still present.

---

## 9. API Keys (Stretch)

For scripts and CI that need to call the API without the browser login flow.

- **Format:** `wk_` + 32 random bytes in base64url. Shown **once** at creation. Stored as `SHA-256` hex in `key_hash`, with the first 8 characters in `key_prefix` for display.
- **Use:** header `X-API-Key: wk_...`. If `X-API-Key` is present it is used instead of the bearer token. Invalid or revoked keys get `401 UNAUTHORIZED`.
- **Scope:** a key acts as its owner for monitors, results, stats, timeseries, incidents, channels, notifications, and the pipeline endpoint. A key **cannot** call `/api/auth/*` or `/api/api-keys*` (those require a JWT), so a leaked key cannot mint more keys or change the account.
- `last_used_at` is updated at most once per minute per key.
- Limit: `MAX_API_KEYS_PER_USER` (default 5).
- Per-key rate limiting uses the same limits as the owner's per-user limiters.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/api-keys` | JWT | List keys (id, name, prefix, createdAt, lastUsedAt, revokedAt) |
| POST | `/api/api-keys` | JWT | Create. Body `{ "name": "CI" }`. Returns `201 { "apiKey": {...}, "key": "wk_..." }` (the only time `key` appears) |
| DELETE | `/api/api-keys/:id` | JWT | Revoke (sets `revoked_at`). `204`. `404` if not owned. |

---

## 10. API Changes

### 10.1 Monitor object additions
```json
{ "failureThreshold": 3, "recoveryThreshold": 2, "alertsEnabled": true,
  "openIncident": { "id": "uuid", "startedAt": "ISO" } }
```
`openIncident` is `null` when none is open. `POST` and `PATCH /api/monitors` accept `failureThreshold` (1 to 10, default 3), `recoveryThreshold` (1 to 10, default 2), and `alertsEnabled` (default true). `GET /api/monitors` loads open incidents with one extra query (not one per monitor).

### 10.2 New and changed endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/incidents` | Bearer or key | List incidents for the user's monitors |
| GET | `/api/monitors/:id/timeseries` | Bearer or key | Section 8.2 |
| GET | `/api/monitors/:id/stats` | Bearer or key | Extended (8.1) |
| GET | `/api/channels` | Bearer or key | List channels and `availableTypes` |
| POST | `/api/channels` | Bearer or key | Create channel |
| PATCH | `/api/channels/:id` | Bearer or key | Update name, active flag, or URL |
| DELETE | `/api/channels/:id` | Bearer or key | Delete (history is kept) |
| POST | `/api/channels/:id/test` | Bearer or key | Queue a test notification |
| GET | `/api/notifications` | Bearer or key | Notification history |
| GET, POST, DELETE | `/api/api-keys...` | JWT only | Stretch (section 9) |
| GET | `/api/openapi.json` | None | OpenAPI document |
| GET | `/api/docs` | None | Swagger UI |

All new routes use the V1 error format, `requireAuth`, ownership scoping (other users' resources return 404), and zod validation with `.strict()` bodies.

### 10.3 Incident object
```json
{
  "id": "uuid",
  "monitorId": "uuid",
  "monitorName": "Payments API",
  "status": "open",
  "startedAt": "ISO",
  "resolvedAt": null,
  "durationSeconds": 342,
  "failedChecks": 5,
  "openedError": "Expected 200, got 503",
  "lastError": "Expected 200, got 503",
  "lastStatusCode": 503
}
```
`status` is `open` or `resolved`. For an open incident, `durationSeconds` is computed against the current time.

### 10.4 `GET /api/incidents`
Query: `status` (`open`, `resolved`, or `all`, default `all`), `monitorId` (optional uuid, must be owned), `limit` (1 to 100, default 50), `before` (optional ISO time, returns incidents with `startedAt` earlier than it). Ordered by `startedAt DESC`. `200 { "incidents": [ ... ] }`.

### 10.5 Channels
**Channel object**
```json
{ "id": "uuid", "type": "slack", "name": "Team Slack", "isActive": true,
  "maskedTarget": "hooks.slack.com/…a1b2", "createdAt": "ISO" }
```
**`GET /api/channels`** returns `{ "channels": [ ... ], "availableTypes": ["slack","discord","webhook"] }` (adds `"email"` when configured).

**`POST /api/channels`** request:
```json
{ "type": "slack", "name": "Team Slack", "url": "https://hooks.slack.com/services/T000/B000/XXXX" }
```
- `name`: 1 to 100 characters, trimmed
- `type`: one of the available types
- `url`: required for `slack`, `discord`, `webhook`. Rejected for `email`.
- Errors: `409 CHANNEL_LIMIT_REACHED`, `400 CHANNEL_TYPE_UNAVAILABLE`, `400 URL_NOT_ALLOWED`.
- `201 { "channel": {...} }`. For `webhook` the response also contains `"signingSecret": "whsec_..."` (shown once, 32 random bytes in base64url with that prefix).

**`PATCH /api/channels/:id`**: any of `name`, `isActive`, `url` (re-validated and re-encrypted; invalid for `email`). `200 { "channel": {...} }`.

**`DELETE /api/channels/:id`**: `204`.

**`POST /api/channels/:id/test`**: inserts a `test` notification (no incident) and returns `202 { "notification": {...} }`. Rate limited to 5 per minute per user. Inactive channels return `409 CHANNEL_INACTIVE`.

### 10.6 Notification history
`GET /api/notifications`: query `limit` (1 to 100, default 50), `before` (ISO created time), optional `status`.
```json
{ "notifications": [ {
  "id": "uuid", "type": "incident.opened", "status": "sent",
  "channelType": "slack", "channelName": "Team Slack",
  "monitorName": "Payments API", "incidentId": "uuid",
  "attempts": 1, "lastError": null, "createdAt": "ISO", "sentAt": "ISO"
} ] }
```
`monitorName` comes from the stored payload.

### 10.7 New error codes
| HTTP | `code` | When |
|---|---|---|
| 400 | `CHANNEL_TYPE_UNAVAILABLE` | `email` requested while the provider is not configured |
| 409 | `CHANNEL_LIMIT_REACHED` | User is at `MAX_CHANNELS_PER_USER` |
| 409 | `CHANNEL_INACTIVE` | Test requested for an inactive channel |
| 409 | `API_KEY_LIMIT_REACHED` | Stretch |

### 10.8 Request IDs (Should)
Every request gets an ID (`x-request-id` from the client if it is a valid UUID, otherwise a new UUID). It is returned in the `x-request-id` response header, included in every log line for that request, and added to error bodies as `error.requestId`.

### 10.9 Rate limits for new routes
Per user: channel create, update, and delete 20 per hour; channel test 5 per minute; API key create 10 per hour. All other new `GET` routes use the global limiter.

---

## 11. OpenAPI and Swagger UI

- Build the spec with `@asteasolutions/zod-to-openapi` from the **same zod schemas** the routes validate with (register each route with its request and response schemas). This prevents the docs drifting from the code.
- `GET /api/openapi.json` returns the spec. `GET /api/docs` serves Swagger UI via `swagger-ui-express`.
- Document: every endpoint in V1, V2, and V3 (including `/health`), request and response bodies, the error format with all error codes, the `bearerAuth` scheme (JWT) and the `apiKeyAuth` scheme (`X-API-Key` header), and an overview with the tagline and the delivery-guarantee notes.
- Group by tags: Auth, Monitors, Results and stats, Incidents, Channels, Notifications, API keys, System.
- **CSP:** Helmet's default Content Security Policy blocks Swagger UI's scripts. Apply a relaxed policy to the `/api/docs` route **only** and keep the strict default everywhere else.
- The docs are public (they contain no secrets). The refresh cookie endpoints are documented but marked as browser-only.
- Docs are reachable through the Vercel rewrite at `https://<app>.vercel.app/api/docs`.

---

## 12. Frontend Changes

Follow `design.md` for all styling. New elements use only existing tokens, radii, shadows, and components (section 12.5 lists the few additions). Copy follows the voice rules in `design.md` section 10: sentence case, the same verb on a button and its toast.

### 12.1 Navigation and routes

Top bar adds links: **Monitors**, **Incidents**, **Settings** (a small text link group between the logo and the user email, `Ghost` button style, the current page marked by a `sun-500` underline of 3px with a rounded end). Under 640px the links move into a menu button. A footer line shows an "API docs" link (`/api/docs`, opens in a new tab).

| Path | Page | Access |
|---|---|---|
| `/dashboard` | Dashboard (changed) | Protected |
| `/monitors/:id` | Monitor detail (changed) | Protected |
| `/incidents` | Incidents timeline (new) | Protected |
| `/settings` | Settings: Alert channels, Notification history, and API keys (Stretch) (new) | Protected |

### 12.2 Dashboard changes
- **Incident banner** at the top, shown only when open incidents exist: clay card with a `down` orb (`sm`), text "1 incident open" or "3 incidents open", the first two monitor names, and a "View incidents" link. Data from `GET /api/incidents?status=open`, polled every 15 seconds.
- Monitor cards with an open incident show a small pill "Incident" (Down pill style) next to the status pill.
- Summary strip and grid unchanged.
- Pipeline card unchanged.

### 12.3 Monitor detail changes
- **Alert settings** appear in the Edit modal under a heading "Alerts": a toggle "Send alerts for this monitor", a select "Open an incident after" (1 to 10) with the suffix "failed checks in a row", and a select "Resolve after" (1 to 10) with "successful checks in a row". Defaults 3 and 2.
- **Open incident notice** under the header when `openIncident` exists: "Incident open since {time}" with duration.
- **Stats row** (24h and 7d toggle as in V1) becomes two rows of tiles: uptime, average, total checks, failed checks; then **p50, p95, p99**, min and max. Latency tiles show an en dash when `null`.
- **Uptime bar:** a row of thin rounded bars, one per bucket, from `GET /api/monitors/:id/timeseries` (buckets filled for gaps). A bar is `sun-500` when `failed = 0`, `blood-400` when `failed > 0`, and `ink-600` when there is no data. Hover and focus show a tooltip (time, checks, failed). Label under it: the window start and "now". It carries a visually hidden text summary.
- **Latency chart** switches to the timeseries data: average as the `ember-500` line (as in `design.md` 6.7) and **p95** as a dashed `ember-300` line with a legend in text ("Average", "95th percentile"). Failed buckets mark the baseline with the `blood-400` marker. The existing "last 100 checks" table stays.
- **Incidents panel** (clay panel, flat rows): this monitor's last 10 incidents (status, started, duration, opened error).

### 12.4 New pages

**Incidents** (`/incidents`):
```text
 Incidents                              ( All | Open | Resolved )

 ┌──────────────────────────────────────────────────────────────┐
 │ (orb)  Payments API                    [Open]   12 min       │
 │        Expected 200, got 503 · 5 failed checks               │
 │        Started 10:02 UTC                                     │
 ├──────────────────────────────────────────────────────────────┤
 │ (orb)  Search                          [Resolved]  4 min     │
 │        Timeout after 10000ms · 3 failed checks               │
 │        10:40 to 10:44 UTC                                    │
 └──────────────────────────────────────────────────────────────┘
```
Filter is a segmented toggle (design.md 6.10). Rows sit in a clay panel as flat rows (design.md 6.6 rules). Open incidents use the `down` orb, resolved ones the `up` orb (`sm`, 20px). Clicking a row opens the monitor. Open incidents refresh every 15 seconds. "Load more" button uses the `before` cursor. Empty state: "No incidents. Everything you monitor has been healthy." (all) or "No open incidents." (open).

**Settings** (`/settings`), sections in clay panels:

1. **Alert channels:** a list of channel cards (type icon, name, masked target, active toggle, "Send test", "Delete") and an "Add channel" primary button. The add modal has a type select (only `availableTypes`), a name field, and a URL field (hidden for email). For webhook channels, after creation show a second dialog with the signing secret, a "Copy" button, and the sentence "This secret is shown once. Store it somewhere safe." Test result appears as a toast, and the history table updates.
2. **Notification history:** a flat table (Time, Monitor, Event, Channel, Status, Attempts). Status uses the pill mapping in 12.5. `lastError` shows in a tooltip and under the row on mobile. Polls every 10 seconds while any row is `pending` or `sending`, otherwise every 60 seconds.
3. **API keys (Stretch):** a list (name, prefix `wk_ab12cd34…`, created, last used, "Revoke") and "Create key". Creation shows the key once with a "Copy" button. Include a short usage example with `X-API-Key`.

Copy additions (extends `design.md` section 10):

| Context | Copy |
|---|---|
| Banner | "1 incident open" / "3 incidents open" |
| Empty channels | "No alert channels yet. Add one to get notified when an incident starts." |
| Channel limit | "You've reached the limit of 5 channels. Delete one to add another." |
| Email unavailable | "Email alerts aren't available on this server." (shown instead of the option) |
| Test queued | "Test notification queued" |
| Webhook secret note | "This secret is shown once. Store it somewhere safe." |
| Suppressed (cooldown) tooltip | "Not sent: a recent alert for this monitor was already sent." |
| Failed tooltip | "Not delivered after 5 attempts." plus the last error |

### 12.5 Design additions (append these to `design.md`)
- **Pills:** notification and incident states reuse existing pill variants with text labels: sent uses the Up style, failed uses the Down style, pending and sending use the Paused (orange) style, suppressed uses the Pending (grey) style. Incident `Open` uses the Down style and `Resolved` uses the Up style.
- **Uptime bar segment:** 6px wide, 28px tall, radius 3px, gap 2px, colors as in 12.3. Focus ring follows the global rule. A flat container with the clay well treatment holds the bar.
- **Nav links:** 44px tall hit area, `cream-300`, hover `cream-100`, current page `cream-100` with the 3px `sun-500` underline.
- **Copy-to-clipboard button:** Secondary icon button, label changes to "Copied" for 2 seconds (announced with `aria-live="polite"`).

---

## 13. Environment Variables

### 13.1 `backend/.env.example` (complete file for V3)

```dotenv
# ---------- Server ----------
NODE_ENV=development              # development | production | test
PORT=8080
LOG_LEVEL=info
TRUST_PROXY=0                     # npm run dev: 0 | Docker Compose behind nginx: 1 | Render behind Vercel: usually 2
# Which parts of the app this process runs (comma-separated): api, scheduler, consumer, notifier
ROLES=api,scheduler,consumer,notifier
# Public URL of the dashboard, used for links inside alerts
APP_PUBLIC_URL=http://localhost:5173

# ---------- Database ----------
DATABASE_URL=postgres://watcher:watcher@localhost:5432/watcher
DIRECT_DATABASE_URL=              # Neon only: the non-pooled string, used for migrations
DB_POOL_MAX=10

# ---------- Auth ----------
JWT_ACCESS_SECRET=change-me-to-a-long-random-string-at-least-32-chars
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL_DAYS=7
BCRYPT_COST=12                    # use 4 in tests only
# 32 random bytes, base64. Generate: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
ENCRYPTION_KEY=
MAX_API_KEYS_PER_USER=5           # Stretch

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
ALLOW_PRIVATE_TARGETS=false       # never true in production

# ---------- Retention ----------
RESULT_RETENTION_DAYS=8           # raised from 7 so a full 7d window is always available
NOTIFICATION_RETENTION_DAYS=30
INCIDENT_RETENTION_DAYS=90

# ---------- Redis ----------
REDIS_URL=redis://localhost:6379  # production: rediss://default:PASSWORD@HOST:PORT
REDIS_KEY_PREFIX=watcher:
STATUS_CACHE_TTL_SECONDS=86400
STATS_CACHE_TTL_SECONDS=30
LOCK_TTL_BUFFER_SECONDS=15
RATE_LIMIT_STORE=redis            # redis | memory (memory is for tests)

# ---------- Queue ----------
QUEUE_DRIVER=kafka                # kafka | redis-streams | memory (memory is for tests only)
QUEUE_FALLBACK_TO_DB=true
PUBLISH_TIMEOUT_MS=5000
CONSUMER_MAX_ATTEMPTS=3
CONSUMER_RETRY_BASE_MS=200
PIPELINE_LAG_WARN=50
REDIS_STREAM_MAXLEN=10000

# ---------- Kafka (used when QUEUE_DRIVER=kafka) ----------
KAFKA_BROKERS=localhost:9092
KAFKA_CLIENT_ID=watcher
KAFKA_SSL=false
KAFKA_SASL_MECHANISM=
KAFKA_USERNAME=
KAFKA_PASSWORD=
KAFKA_TOPIC_RESULTS=check.results
KAFKA_TOPIC_DLQ=check.results.dlq
KAFKA_TOPIC_PARTITIONS=3
KAFKA_AUTO_CREATE_TOPICS=true
KAFKA_CONSUMER_GROUP=watcher-result-writers

# ---------- Alerts and notifications ----------
NOTIFIER_TICK_SECONDS=5
NOTIFY_BATCH_SIZE=20
NOTIFY_MAX_ATTEMPTS=5
NOTIFY_BACKOFF_SECONDS=30,120,600,1800
NOTIFY_TIMEOUT_MS=10000
ALERT_COOLDOWN_SECONDS=600
NOTIFY_MAX_PER_CHANNEL_PER_HOUR=20
MAX_CHANNELS_PER_USER=5

# ---------- Email (optional, Should) ----------
EMAIL_PROVIDER=none               # none | resend
RESEND_API_KEY=
EMAIL_FROM=Watcher <alerts@example.com>
```

Boot validation additions (zod):
- `ENCRYPTION_KEY` decodes to exactly 32 bytes when the `api` or `notifier` role is active.
- `NOTIFY_BACKOFF_SECONDS` parses to a non-empty list of positive integers.
- `RESEND_API_KEY` and `EMAIL_FROM` are required when `EMAIL_PROVIDER=resend`.
- `APP_PUBLIC_URL` is a valid URL.
- Never log `ENCRYPTION_KEY`, `RESEND_API_KEY`, or any channel target.

### 13.2 `frontend/.env.example`
**No changes from V1.** The API docs link uses the relative path `/api/docs`.

---

## 14. Quality, CI, and Repository

### 14.1 Lint, format, typecheck
- Add a flat config `backend/eslint.config.js` and `frontend/eslint.config.js` (`@eslint/js` recommended plus `typescript-eslint` recommended, with `eslint-config-prettier` last; the frontend also loads the React hooks rules if the template ships them). V2's ESLint run failed for lack of a config file, so this fixes it.
- Add `.prettierrc` (single quotes, semicolons, 100 columns, trailing commas `all`) and `.prettierignore`.
- Scripts in both packages: `lint`, `typecheck` (`tsc --noEmit`), `format` (write), and `format:check`.
- The whole repository must pass `lint`, `typecheck`, and `format:check` with **zero warnings treated as errors** (`--max-warnings 0`).

### 14.2 GitHub Actions: `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  backend:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: watcher
          POSTGRES_PASSWORD: watcher
          POSTGRES_DB: watcher
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U watcher"
          --health-interval 5s --health-timeout 5s --health-retries 10
      redis:
        image: redis:7-alpine
        ports: ["6379:6379"]
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 5s --health-timeout 5s --health-retries 10
    env:
      NODE_ENV: test
      DATABASE_URL: postgres://watcher:watcher@localhost:5432/watcher
      REDIS_URL: redis://localhost:6379
      KAFKA_BROKERS: localhost:9092
      JWT_ACCESS_SECRET: ci-secret-ci-secret-ci-secret-ci-secret-1234
      ENCRYPTION_KEY: MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=
      BCRYPT_COST: "4"
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: backend/package-lock.json
      - name: Start Kafka (for integration tests)
        run: docker compose up -d --wait --wait-timeout 180 kafka
      - run: npm ci
        working-directory: backend
      - run: npm run lint
        working-directory: backend
      - run: npm run format:check
        working-directory: backend
      - run: npm run typecheck
        working-directory: backend
      - run: npm run migrate
        working-directory: backend
      - run: npm test
        working-directory: backend
      - run: npm run test:integration
        working-directory: backend

  frontend:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
      - run: npm run lint
      - run: npm run format:check
      - run: npm run typecheck
      - run: npm run build

  docker:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    needs: [backend, frontend]
    steps:
      - uses: actions/checkout@v4
      - run: docker compose build

  audit:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm audit --omit=dev --audit-level=high
        working-directory: backend
      - run: npm audit --omit=dev --audit-level=high
        working-directory: frontend
```
Notes: the `ENCRYPTION_KEY` above is a throwaway test value (32 bytes, base64) that must never be used outside CI. Pin action versions to the current major releases when you commit. In Render and Vercel, enable "auto-deploy after CI passes" if the option is available so a red build does not deploy.

### 14.3 Dependabot: `.github/dependabot.yml`
Weekly updates for `npm` in `/backend` and `/frontend`, `github-actions` in `/`, and `docker` in `/backend` and `/frontend`, with a limit of 5 open pull requests per ecosystem.

### 14.4 Retention job (extends V1 and V2)
Hourly, in the `scheduler` role, in batches of 5000:
- `check_results` older than `RESULT_RETENTION_DAYS` (existing)
- `notifications` older than `NOTIFICATION_RETENTION_DAYS` that are in a final status (`sent`, `failed`, `suppressed`)
- resolved `incidents` with `resolved_at` older than `INCIDENT_RETENTION_DAYS`
- `refresh_tokens` whose `expires_at` or `revoked_at` is more than 7 days old (a V1 gap that this closes)

### 14.5 README (final version, Must)
The README is the first thing a recruiter reads. It must contain:
1. Title, tagline, **live demo link**, CI status badge, and a one-sentence summary.
2. A **demo GIF or screenshots**: dashboard, monitor detail with analytics, an incident, the alerts settings page, and the Pipeline card.
3. Feature list in six or seven bullets.
4. **Architecture diagram** (the V3 Mermaid diagram) and a short walkthrough of one check and one alert.
5. **Design decisions** (section 3.4 and the V2 ones): outbox, thresholds and hysteresis, cooldown, idempotency, Redis as a cache, SSRF, secrets at rest, why Kafka.
6. **Failure behavior table** covering the consumer, notifier, Redis, Kafka, a failing webhook, and Render sleeping.
7. **Delivery and correctness notes:** at-least-once plus idempotent writes, the incident duration caveat, percentiles computed over successful checks only.
8. **Security notes:** token design, ownership checks, SSRF in both directions, encryption of stored URLs, signed webhooks, API keys hashed, strict CSP except on the docs page.
9. **API:** link to `/api/docs`, and a short `curl` example with `X-API-Key` if API keys exist.
10. **Run it locally** in one command, and how to run tests (`npm test`, `npm run test:integration`).
11. **Deploy notes:** Neon, Render (single process, all roles), Vercel rewrite, free tier sleep, which queue driver production uses and why.
12. **Known limitations and roadmap:** short and honest (no status pages, no maintenance windows, single-process production, free-tier sleep).

---

## 15. Folder Structure Changes

```
.github/
├── workflows/ci.yml
└── dependabot.yml
backend/
├── eslint.config.js
├── .prettierrc
├── migrations/ (…0006 to …0010)
├── src/
│   ├── lib/crypto.ts                       # encrypt / decrypt, signing helpers
│   ├── lib/requestId.ts
│   ├── incidents/engine.ts                 # used inside recordResult's transaction
│   ├── notifier/ (notifier.ts, deliver.ts, render.ts, adapters/{slack,discord,webhook,email}.ts)
│   ├── modules/
│   │   ├── incidents/   (incident.routes.ts, incident.service.ts, incident.schemas.ts)
│   │   ├── channels/    (channel.routes.ts, channel.service.ts, channel.schemas.ts)
│   │   ├── notifications/ (notification.routes.ts, notification.service.ts)
│   │   ├── analytics/   (analytics.service.ts, analytics.routes.ts)
│   │   └── apiKeys/     (apiKey.routes.ts, apiKey.service.ts)           # Stretch
│   ├── docs/ (openapi.ts, registry.ts, docs.routes.ts)
│   └── middleware/auth.ts                  # JWT or X-API-Key (Stretch)
└── tests/ (incidentEngine.test.ts, notifier.test.ts, crypto.test.ts, channels.test.ts,
            analytics.test.ts, openapi.test.ts, apiKeys.test.ts)
frontend/
├── eslint.config.js
├── .prettierrc
└── src/
    ├── api/ (incidents.ts, channels.ts, notifications.ts, apiKeys.ts)
    ├── pages/ (Incidents.tsx, Settings.tsx)
    └── components/ (IncidentBanner.tsx, IncidentRow.tsx, UptimeBar.tsx, StatsGrid.tsx,
                     ChannelCard.tsx, ChannelForm.tsx, NotificationTable.tsx, ApiKeysPanel.tsx)
docker-compose.yml                          # adds the notifier service
```

`package.json` additions: dependencies `@asteasolutions/zod-to-openapi`, `swagger-ui-express`; dev dependencies `@apidevtools/swagger-parser`, `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-config-prettier`, `prettier`, `@types/swagger-ui-express`.

---

## 16. Testing Requirements

**Unit tests** (`npm test`, memory queue, memory rate-limit store, no Redis or Kafka needed; Postgres required):
1. **Incident engine:** every scenario in section 6.3, driven by calling `recordResult` with crafted events (table-driven). Include the duplicate-event and late-event cases, `alerts_enabled = false`, an inactive channel, and threshold 1.
2. **Notification enqueue:** one row per active channel, unique index prevents duplicates when the same event is processed twice.
3. **Notifier:** with a fake HTTP target and an injectable clock: success marks `sent`; a 503 retries with the configured backoff and ends `failed` after `NOTIFY_MAX_ATTEMPTS`; a 404 fails immediately; a 429 honors `Retry-After`; an expired `sending` lock is reclaimed; two notifier instances never send the same row twice; a resolved notification is suppressed when its opened notification was not sent; the hourly cap suppresses; a deleted or inactive channel suppresses; an SSRF-blocked URL fails permanently.
4. **Cooldown** (integration, needs Redis): second `incident.opened` for the same monitor and channel inside the cooldown is `suppressed`; with Redis down it is sent.
5. **Crypto:** round trip, a tampered value fails, a wrong key fails, `v1:` prefix present, two encryptions of the same plaintext differ.
6. **Signing:** the webhook signature verifies with the shared secret and fails with a modified body or an old timestamp.
7. **Rendering:** Slack escaping of `& < >`, HTML email escaping, Discord payload contains `allowed_mentions` with an empty `parse`, durations format correctly.
8. **Channels API:** create and list return only masked targets (no full URL anywhere in any response); ownership returns 404; `http://127.0.0.1` and a Slack URL on the wrong host are rejected; the channel limit is enforced; the stored column is ciphertext (`v1:` prefix) and not the URL; the webhook signing secret is returned once.
9. **Analytics:** a fixed dataset produces known p50, p95, p99, min, max, and uptime; `null` values when there are no successful checks; time series buckets align to `date_bin` and are sorted; the cache returns the same payload within the TTL; another user's request for the same monitor is a 404 even when a cached entry exists.
10. **OpenAPI:** the generated document validates with `swagger-parser`; paths for the key routes exist; `/api/docs` responds with HTML and a relaxed CSP while `/api/monitors` keeps the strict one.
11. **API keys (Stretch):** key auth works; a revoked key gets 401; a key cannot call `/api/auth/*` or `/api/api-keys*`; only the SHA-256 hash is stored; the full key is returned once.
12. **Retention:** old notifications, resolved incidents, and expired tokens are deleted in batches, and open incidents are never deleted.

**Frontend:** manual checklist (implementation plan) and a passing `build`, `lint`, `typecheck`.

**CI:** the pipeline in 14.2 passes on a pull request, including the Kafka integration tests.

---

## 17. Deployment Requirements

| Piece | Setup |
|---|---|
| **Neon** | Unchanged. The five new migrations run through the normal start command. |
| **Render** | Add env vars from 13.1: `ROLES=api,scheduler,consumer,notifier`, `ENCRYPTION_KEY` (a **new** key, never the CI one), `APP_PUBLIC_URL` (the Vercel URL), the notifier variables, and `RESULT_RETENTION_DAYS=8`. Optional: `EMAIL_PROVIDER` and its keys. Build and start commands unchanged. |
| **Vercel** | Unchanged. The existing `/api/*` rewrite also serves `/api/docs`. |
| **GitHub** | Add the workflow and Dependabot files. Enable auto-deploy-after-CI on Render and Vercel if offered. |

Production checks:
- Create a real Slack or Discord webhook for a test channel and send a test notification from the deployed app.
- Back up the `ENCRYPTION_KEY` somewhere safe. Losing it makes stored channel URLs unrecoverable (users would have to re-enter them).
- Render sleeping pauses the scheduler, consumer, and notifier together. An incident only opens while the service is awake. State this in the README.

---

## 18. Acceptance Criteria (Definition of Done)

Local (`docker compose up --build`, app at `http://localhost:3000`):

1. **Channels:** create a Discord or Slack channel and a generic webhook (a free request-capture service works as a receiver). Press "Send test" on each. Each receives a message, and the history shows **Sent**.
2. **Incident opens once:** add a monitor for `https://example.com` with interval 60 seconds and thresholds 3 and 2. Edit its expected status code to `418` so it fails. After 3 failed checks an incident opens **exactly once**. Each active channel gets **one** "is down" message. The dashboard banner shows "1 incident open". Further failures do not send more messages.
3. **Incident resolves once:** change the expected status code back to `200`. After 2 successful checks the incident resolves, each channel gets **one** "recovered" message, and the incidents page shows the correct duration.
4. **Flapping:** alternating pass and fail does not open an incident. Opening several short incidents in a row produces `suppressed` notifications with the cooldown reason, visible in the history.
5. **Retries:** point a webhook channel at an endpoint that returns 503. The history shows increasing attempts with backoff, then **Failed**. A 404 target fails on the first attempt.
6. **Crash recovery:** `docker compose stop notifier`, trigger an incident, then `docker compose start notifier`. The pending messages are delivered once.
7. **Redis down:** alerts still send, and the app behaves as in V2.
8. **Secrets:** `select target_encrypted from notification_channels;` shows `v1:...` ciphertext. No API response and no log line contains a full webhook URL.
9. **Webhook signature:** the receiver can verify `X-Watcher-Signature` with the signing secret shown at creation.
10. **Analytics:** the monitor detail page shows uptime, average, p50, p95, p99, min, and max, the uptime bar, and a latency chart with both lines. Values match a manual SQL check on the same window.
11. **API docs:** `/api/docs` loads, "Authorize" with a bearer token works, and "Try it out" succeeds on `GET /api/monitors`. `/api/openapi.json` validates.
12. **API keys (Stretch):** create a key, call `GET /api/monitors` with `X-API-Key`, revoke it, and the same call returns 401.
13. **Quality:** `npm run lint`, `format:check`, `typecheck`, `npm test`, and `npm run test:integration` all pass locally in both packages.
14. **V2 regression:** the V2 acceptance criteria still pass (catch-up demo, poison message, Redis outage, Kafka outage, two schedulers).

CI and production:

15. A pull request runs the CI workflow and it passes (backend, frontend, docker build, audit).
16. The deployed app works end to end: the Vercel URL, register, a monitor, a real test alert delivered to a real channel, an incident opened and resolved.
17. The README is complete per 14.5, with a live link, a CI badge, and screenshots or a GIF.
18. Repo committed and tagged `v3`.

---

## 19. Risks and Decisions

| Risk or decision | Mitigation |
|---|---|
| Alert fatigue from flapping | Thresholds with hysteresis, Redis cooldown, per-channel hourly cap, visible `suppressed` history |
| Alerts lost on a crash | Transactional outbox plus claim-based delivery with crash recovery |
| Duplicate alerts | Unique index on `(incident_id, channel_id, type)` |
| Webhook URLs are secrets and SSRF vectors | Encryption at rest, never returned, host restrictions, SSRF-safe delivery |
| `ENCRYPTION_KEY` lost or leaked | Store a backup. Rotation is out of scope, and the `v1:` prefix leaves room for it |
| Email deliverability, free-tier limits, and SMTP blocked on free Render | HTTPS email API only, optional feature, recipient limited to the account's own address |
| Incident duration overstates downtime by up to `recovery_threshold - 1` intervals | Documented in the README |
| Percentiles computed over successful checks only | Documented in the README and the OpenAPI description |
| Raw data kept only 8 days, so no long-range analytics | Documented limitation. Rollups are a possible future step |
| Free Render sleep pauses all roles | Documented. Incidents open only while the service is awake |
| Manual checks count toward incident thresholds | Documented. They are rate limited, so abuse is bounded |
| Swagger UI needs a relaxed CSP | Applied to `/api/docs` only |
| Scope is large for the time available | Priority labels in section 1.3. Cut Stretch, then Should, never a half-built Must |
