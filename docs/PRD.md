# Watcher: Product Requirements Document (Version 1)

> **Your APIs. Always in Sight.**

| | |
|---|---|
| **Product** | Watcher, an API uptime and latency monitor |
| **Version** | 1.0 ("Working Monitor") |
| **Audience** | AI coding agent (Copilot or similar) and the human reviewing it |
| **Companion doc** | `implementation.md` (the step-by-step build order) |

> **Agent instructions:** This document is the source of truth for Version 1. Build exactly what is described. Do not add Kafka, Redis, or any feature listed under "Out of Scope". Where this document gives a name, path, route, or column, use it verbatim. If something is ambiguous, choose the simplest option that satisfies the acceptance criteria and note the choice in the README.

---

## 1. Overview

Watcher lets a registered user add HTTP(S) endpoints, checks them on a schedule, records the result of each check, and shows current status and recent history on a dashboard.

Version 1 is deliberately simple: **one backend process** does the API, scheduling, and checking, and writes straight to Postgres. Versions 2 and 3 add Redis, Kafka, alerting, and analytics. Version 1 must therefore be structured so that those additions are small changes (see section 4.4, "Forward-compatibility").

### 1.1 Goals
1. A user can register, log in, and manage their own monitors.
2. Monitors are checked automatically at their configured interval.
3. The dashboard shows up/down status, last response time, and a latency chart.
4. Authentication is secure and every monitor is private to its owner.
5. The user-supplied URL feature cannot be abused to reach internal networks (SSRF protection).
6. The system is deployed and reachable at public URLs (Neon, Render, Vercel).

### 1.2 Non-Goals (Out of Scope for V1)
- Kafka, Redis, or any message queue (V2)
- Alerting (email, Slack, Discord), incidents, uptime percentage over 7 days, and p50/p95 percentiles (V3)
- Social login, email verification, password reset, roles or teams
- Multi-region checks, status pages, custom headers or request bodies for checks
- Following HTTP redirects (a 3xx response is treated as the status code it returned)

---

## 2. Tech Stack (Version 1)

### 2.1 Backend
| Concern | Choice |
|---|---|
| Runtime | Node.js 20 LTS |
| Language | TypeScript (strict mode), ES modules |
| Framework | Express 4 |
| Validation | `zod` |
| Database driver | `pg` (node-pg), raw parameterized SQL, no ORM |
| Migrations | `node-pg-migrate` (SQL migrations) |
| Password hashing | `bcryptjs` (cost 12) |
| Tokens | `jsonwebtoken` (HS256, access tokens only) |
| HTTP checks | `undici` (`request` and `Agent`) |
| IP classification | `ipaddr.js` |
| Security middleware | `helmet`, `cors`, `express-rate-limit`, `cookie-parser` |
| Logging | `pino` and `pino-http` |
| Concurrency | `p-limit` |
| Tests | `vitest` and `supertest` |
| Dev tooling | `tsx`, `eslint`, `prettier` |

### 2.2 Frontend
| Concern | Choice |
|---|---|
| Build tool | Vite 5 |
| Framework | React 18 and TypeScript |
| Routing | `react-router-dom` v6 |
| Server state | `@tanstack/react-query` v5 |
| HTTP client | `axios` |
| Styling | Tailwind CSS 3 |
| Charts | `recharts` |
| Forms | `react-hook-form` and `zod` (`@hookform/resolvers`) |

### 2.3 Infrastructure
| Concern | Choice |
|---|---|
| Database | PostgreSQL 16, **Neon** in production and Docker locally |
| Backend hosting | **Render** web service (free tier) |
| Frontend hosting | **Vercel** |
| Local dev | Docker Compose (Postgres only) |

---

## 3. Users and Core Flows

**Persona:** a developer who wants to know when their API goes down.

1. **Sign up:** the user enters an email and password, and is logged in.
2. **Add monitor:** the user enters a name, URL, interval, and expected status code. The first check runs within one scheduler tick.
3. **Watch:** the dashboard lists monitors with status badges. It refreshes every 15 seconds.
4. **Inspect:** the monitor detail page shows a latency chart, a table of recent checks, and stats.
5. **Manage:** the user can pause, resume, edit, delete, or trigger a manual check.

---

## 4. System Architecture

### 4.1 Diagram

```mermaid
flowchart LR
    U[Browser] -->|HTTPS| V[Vercel: React SPA]
    V -->|"/api/* rewrite (same-origin)"| R

    subgraph R[Render: Node.js web service]
        API[Express API]
        SCH[In-process scheduler]
        CHK[Checker - SSRF-safe]
        API --- SCH
        SCH --> CHK
    end

    API -->|SQL| N[(Neon Postgres)]
    SCH -->|claim due monitors / write results| N
    CHK -->|HTTP request| T[Monitored endpoints]
```

### 4.2 Components
- **React SPA (Vercel):** UI only. It calls `/api/*` on its own origin. Vercel rewrites those requests to the Render service, so the refresh-token cookie is first-party.
- **Express API:** auth, monitor CRUD, results, stats, health.
- **Scheduler:** a timer inside the same process. Every `SCHEDULER_TICK_SECONDS` it claims due monitors, runs checks with bounded concurrency, and records results.
- **Checker:** a pure function `runCheck(monitor) -> CheckOutcome`. It makes the HTTP request through an SSRF-safe agent. It does not touch the database.
- **Postgres:** the single source of truth.

### 4.3 Request and Data Flow

**Authentication**
```
Register/Login -> API verifies -> returns { accessToken } in the JSON body
              -> sets refresh token in an httpOnly cookie (Path=/api/auth)
SPA keeps accessToken in memory only, sent as "Authorization: Bearer <token>"
On 401 or page load -> POST /api/auth/refresh (cookie) -> new accessToken + rotated refresh cookie
```

**Scheduled check**
```
tick -> UPDATE monitors SET next_check_at = now() + interval
        WHERE id IN (SELECT id ... WHERE is_active AND next_check_at <= now()
                     ORDER BY next_check_at LIMIT 50 FOR UPDATE SKIP LOCKED)
        RETURNING *                                   (claims the monitors atomically)
     -> for each claimed monitor (p-limit CHECK_CONCURRENCY):
          outcome = runCheck(monitor)
          recordResult(monitor, outcome)              (one transaction: insert + update monitor)
```
Claiming by advancing `next_check_at` makes it safe to run more than one instance. This matters in V2.

### 4.4 Forward-compatibility (required)
So V2 can swap in Kafka and Redis with minimal change:
- `runCheck()` must be a pure function with no DB access.
- Result persistence must go through one function, `recordResult(monitor, outcome)`, in `src/modules/results/result.service.ts`. In V2 the scheduler will publish to Kafka and a consumer will call this same function.
- Keep the scheduler logic (`claimDueMonitors`, `tick`) separate from the HTTP server so it can later become its own process. `SCHEDULER_ENABLED=false` must turn it off in the API process.
- Do not import Express types in services. Services take plain arguments.

### 4.5 Folder Structure

```
watcher/
├── docker-compose.yml
├── README.md
├── .gitignore
├── docs/
│   ├── PRD.md
│   └── implementation.md
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── Dockerfile
│   ├── .env.example
│   ├── migrations/
│   │   ├── 1700000000001_create-users.sql
│   │   ├── 1700000000002_create-refresh-tokens.sql
│   │   ├── 1700000000003_create-monitors.sql
│   │   └── 1700000000004_create-check-results.sql
│   ├── src/
│   │   ├── server.ts                  # entry: start HTTP + scheduler, graceful shutdown
│   │   ├── app.ts                     # builds the Express app (exported for tests)
│   │   ├── config/env.ts              # zod-validated env
│   │   ├── db/pool.ts                 # pg Pool + tx helper
│   │   ├── lib/
│   │   │   ├── logger.ts
│   │   │   ├── errors.ts              # AppError + error codes
│   │   │   ├── tokens.ts              # JWT + refresh token helpers
│   │   │   └── ssrf.ts                # URL validation + safe lookup
│   │   ├── middleware/
│   │   │   ├── auth.ts                # requireAuth
│   │   │   ├── rateLimit.ts
│   │   │   ├── validate.ts            # zod request validator
│   │   │   └── errorHandler.ts
│   │   ├── modules/
│   │   │   ├── auth/        (auth.routes.ts, auth.service.ts, auth.schemas.ts)
│   │   │   ├── monitors/    (monitor.routes.ts, monitor.service.ts, monitor.schemas.ts)
│   │   │   └── results/     (result.routes.ts, result.service.ts)
│   │   ├── checker/runCheck.ts
│   │   └── scheduler/       (scheduler.ts, retention.ts)
│   └── tests/
└── frontend/
    ├── package.json
    ├── vite.config.ts
    ├── vercel.json
    ├── tailwind.config.js
    ├── .env.example
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx                    # routes
        ├── api/                       # client.ts, auth.ts, monitors.ts
        ├── auth/                      # AuthContext.tsx, ProtectedRoute.tsx
        ├── pages/                     # Login, Register, Dashboard, MonitorDetail, NotFound
        ├── components/                # StatusBadge, MonitorCard, MonitorForm, LatencyChart, ...
        └── lib/                       # format.ts, queryClient.ts
```

---

## 5. Database

Postgres 16. Migrations are plain SQL files run by `node-pg-migrate` in filename order. All timestamps are `timestamptz` (UTC). IDs are UUIDs, except `check_results.id`, which is a `bigserial` because that table will be large.

### 5.1 Entity Relationship

```mermaid
erDiagram
    users ||--o{ refresh_tokens : has
    users ||--o{ monitors : owns
    monitors ||--o{ check_results : produces
```

### 5.2 Migrations

**`1700000000001_create-users.sql`**
```sql
-- Up Migration
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text        NOT NULL,
  password_hash text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));

-- Down Migration
DROP TABLE users;
```

**`1700000000002_create-refresh-tokens.sql`**
```sql
-- Up Migration
CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id   uuid        NOT NULL,              -- one family per login session
  token_hash  text        NOT NULL UNIQUE,       -- SHA-256 hex of the raw token
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx   ON refresh_tokens (user_id);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);

-- Down Migration
DROP TABLE refresh_tokens;
```

**`1700000000003_create-monitors.sql`**
```sql
-- Up Migration
CREATE TABLE monitors (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                  varchar(100) NOT NULL,
  url                   text         NOT NULL,
  method                text         NOT NULL DEFAULT 'GET' CHECK (method IN ('GET','HEAD')),
  interval_seconds      integer      NOT NULL DEFAULT 300 CHECK (interval_seconds BETWEEN 30 AND 86400),
  expected_status_code  integer      NOT NULL DEFAULT 200 CHECK (expected_status_code BETWEEN 100 AND 599),
  timeout_ms            integer      NOT NULL DEFAULT 10000 CHECK (timeout_ms BETWEEN 1000 AND 30000),
  is_active             boolean      NOT NULL DEFAULT true,

  -- denormalized "latest state" for fast dashboard reads
  current_status        text         NOT NULL DEFAULT 'pending' CHECK (current_status IN ('pending','up','down')),
  consecutive_failures  integer      NOT NULL DEFAULT 0,
  last_checked_at       timestamptz,
  last_response_time_ms integer,
  last_status_code      integer,
  last_error            text,

  next_check_at         timestamptz  NOT NULL DEFAULT now(),
  created_at            timestamptz  NOT NULL DEFAULT now(),
  updated_at            timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX monitors_user_idx ON monitors (user_id);
CREATE INDEX monitors_due_idx  ON monitors (next_check_at) WHERE is_active;

-- Down Migration
DROP TABLE monitors;
```

**`1700000000004_create-check-results.sql`**
```sql
-- Up Migration
CREATE TABLE check_results (
  id               bigserial PRIMARY KEY,
  monitor_id       uuid        NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  checked_at       timestamptz NOT NULL DEFAULT now(),
  status           text        NOT NULL CHECK (status IN ('up','down')),
  status_code      integer,
  response_time_ms integer,
  error            text
);
CREATE INDEX check_results_monitor_time_idx ON check_results (monitor_id, checked_at DESC);
CREATE INDEX check_results_checked_at_idx   ON check_results (checked_at);  -- retention cleanup

-- Down Migration
DROP TABLE check_results;
```

### 5.3 Data Rules
- `email` is stored as entered (trimmed), and uniqueness is case-insensitive via the `lower(email)` index. Always look users up with `lower(email) = lower($1)`.
- Every query on `monitors` and `check_results` must be scoped to the authenticated user (see section 7.2).
- `current_status` is `pending` until the first check completes. The UI shows **Paused** when `is_active = false`, regardless of `current_status`.
- A check is **up** when there is no network error and `status_code === expected_status_code`. Otherwise it is **down**. Response bodies are never stored.
- `error` is a short sanitized string (for example `Timeout after 10000ms`, `DNS lookup failed`, `Expected 200, got 503`, `Blocked: private address`). It must never contain stack traces.

---

## 6. Authentication and Security Design

### 6.1 Model
Email and password. Short-lived **access token** (JWT) plus a rotating **refresh token** in an httpOnly cookie.

| Item | Specification |
|---|---|
| Password rules | 10 to 72 characters (72 is bcrypt's limit). No other composition rules. |
| Hashing | `bcryptjs`, cost from `BCRYPT_COST` (default 12) |
| Access token | JWT, HS256 with `JWT_ACCESS_SECRET`, TTL `ACCESS_TOKEN_TTL` (default `15m`). Claims: `sub` (user id), `iat`, `exp`. Verify with `algorithms: ['HS256']` explicitly. |
| Access token storage (SPA) | In memory only (React state or module variable). **Never localStorage.** |
| Refresh token | 48 random bytes (`crypto.randomBytes`), base64url. Only its **SHA-256 hash** is stored. TTL `REFRESH_TOKEN_TTL_DAYS` (default 7). |
| Refresh cookie | Name `watcher_rt`. `HttpOnly`, `Secure` (production), `SameSite` from `COOKIE_SAMESITE` (default `lax`), `Path=/api/auth`, `Max-Age` equal to the TTL. |
| Rotation | Every `/auth/refresh` revokes the presented token and issues a new one in the same `family_id`. |
| Reuse detection | If a revoked or expired token is presented, revoke the entire family (all tokens with that `family_id`) and return 401. |
| Logout | Revoke the presented token's family, clear the cookie, return 204. |
| Login errors | Always `401 INVALID_CREDENTIALS` with the same message. If the user does not exist, still run a bcrypt compare against a dummy hash to equalize timing. |
| Register errors | `409 EMAIL_TAKEN` is acceptable for V1 (no enumeration protection beyond rate limiting). |

### 6.2 Auth Flow
1. `POST /api/auth/register` or `/login` returns `{ accessToken, user }` and sets the cookie.
2. The SPA sends `Authorization: Bearer <accessToken>`.
3. On page load, the SPA calls `POST /api/auth/refresh` (no body). If it succeeds, the user stays logged in.
4. The axios interceptor retries a request once after a 401 by refreshing first. Concurrent 401s share one refresh promise. If the refresh fails, redirect to `/login`.

### 6.3 Security Requirements (all mandatory)
1. **Parameterized SQL only.** No string concatenation of user input.
2. **Validation:** every request body, query, and param goes through zod. Reject unknown fields (`.strict()`) on bodies.
3. **Ownership checks:** a user can only read or modify their own monitors. Accessing another user's resource returns **404**, not 403.
4. **Helmet** with defaults. `app.disable('x-powered-by')`.
5. **CORS:** an allowlist from `CORS_ORIGINS` (comma-separated), `credentials: true`. Never `*`.
6. **Body size limit:** `express.json({ limit: '10kb' })`.
7. **Rate limiting** (in-memory store in V1; Redis arrives in V2):
   | Scope | Limit |
   |---|---|
   | All `/api` routes, per IP | 120 requests per minute |
   | `POST /api/auth/login`, per IP | 10 per 15 minutes |
   | `POST /api/auth/register`, per IP | 5 per hour |
   | `POST /api/monitors/:id/check`, per user | 10 per minute |
   Return `429` with code `RATE_LIMITED`.
8. **Origin check on cookie endpoints:** for `POST /api/auth/refresh` and `/logout`, if an `Origin` header is present and not in `CORS_ORIGINS`, return 403. (Defense in depth on top of `SameSite`.)
9. **No secrets in logs.** Configure pino `redact` for `req.headers.authorization`, `req.headers.cookie`, `res.headers["set-cookie"]`, and any `password` field.
10. **Generic 500s:** the client gets `{ error: { code: "INTERNAL", message: "Something went wrong" } }`. Details go to the logs only.
11. **Env validation at boot:** the process exits with a clear message if required env vars are missing or weak (`JWT_ACCESS_SECRET` shorter than 32 characters).
12. **Trust proxy:** `app.set('trust proxy', TRUST_PROXY)`. See the note in section 9.3.

### 6.4 SSRF Protection (mandatory, because users supply URLs)
Watcher makes server-side requests to user-supplied URLs. Without protection a user could probe internal networks or cloud metadata endpoints.

**Rules** (implement in `src/lib/ssrf.ts`):
1. Scheme must be `http:` or `https:`. No credentials in the URL (`user:pass@`).
2. Maximum URL length 2048.
3. Reject hostnames `localhost` and anything ending in `.local`, `.internal`, or `.localhost`.
4. After DNS resolution, **every** resolved address must be public. Using `ipaddr.js`, allow only addresses whose `range()` is `'unicast'`. This blocks loopback, private, link-local (169.254.x.x, including cloud metadata), carrier-grade NAT, multicast, and reserved ranges. Normalize IPv4-mapped IPv6 addresses (`::ffff:a.b.c.d`) first.
5. **Enforce at connect time, not only at creation.** Build an `undici` `Agent` with a custom `connect.lookup` that resolves the hostname and rejects non-public addresses. This defeats DNS rebinding. The `lookup` callback may be invoked with either `(err, address, family)` or `(err, addresses[])` depending on options, so handle both.
6. Also validate on `POST` and `PATCH` of a monitor, with a fast DNS check, so users get a `400 URL_NOT_ALLOWED` immediately.
7. Do **not** follow redirects (`maxRedirections: 0`).
8. Timeout from `timeout_ms`, using both `headersTimeout` and an `AbortSignal`. Read and discard the body (destroy it) without buffering. Never store response content.
9. `ALLOW_PRIVATE_TARGETS=true` disables rules 3 to 5 for local development only. It must default to `false`, and the app must log a warning at boot if it is true when `NODE_ENV=production`.

---

## 7. API Specification

Base path `/api`. JSON everywhere. Field names in JSON are **camelCase**, and DB columns are snake_case. Map between them in the service layer.

### 7.1 Conventions

**Error format** (all errors)
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid request", "details": [ { "path": "url", "message": "Invalid URL" } ] } }
```

| HTTP | `code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | zod failure (include `details`) |
| 400 | `URL_NOT_ALLOWED` | SSRF rules rejected the URL |
| 401 | `UNAUTHORIZED` | missing, invalid, or expired access token |
| 401 | `INVALID_CREDENTIALS` | bad email or password |
| 403 | `FORBIDDEN_ORIGIN` | origin check failed |
| 404 | `NOT_FOUND` | unknown route or resource not owned by the user |
| 409 | `EMAIL_TAKEN` | duplicate email |
| 409 | `MONITOR_LIMIT_REACHED` | user hit `MAX_MONITORS_PER_USER` |
| 429 | `RATE_LIMITED` | rate limit |
| 500 | `INTERNAL` | anything unexpected |

**Monitor object**
```json
{
  "id": "uuid",
  "name": "Payments API",
  "url": "https://api.example.com/health",
  "method": "GET",
  "intervalSeconds": 300,
  "expectedStatusCode": 200,
  "timeoutMs": 10000,
  "isActive": true,
  "currentStatus": "up",
  "lastCheckedAt": "2026-01-01T10:00:00.000Z",
  "lastResponseTimeMs": 142,
  "lastStatusCode": 200,
  "lastError": null,
  "nextCheckAt": "2026-01-01T10:05:00.000Z",
  "createdAt": "2026-01-01T09:00:00.000Z",
  "updatedAt": "2026-01-01T10:00:00.000Z"
}
```

**Result object**
```json
{ "id": 123, "checkedAt": "2026-01-01T10:00:00.000Z", "status": "up", "statusCode": 200, "responseTimeMs": 142, "error": null }
```

### 7.2 Endpoint Table

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | No | Liveness and DB ping. **Not** under `/api` and not rate limited |
| POST | `/api/auth/register` | No | Create account |
| POST | `/api/auth/login` | No | Log in |
| POST | `/api/auth/refresh` | Cookie | Rotate refresh token, return a new access token |
| POST | `/api/auth/logout` | Cookie | Revoke the session |
| GET | `/api/auth/me` | Bearer | Current user |
| POST | `/api/monitors` | Bearer | Create monitor |
| GET | `/api/monitors` | Bearer | List the user's monitors |
| GET | `/api/monitors/:id` | Bearer | Get one monitor |
| PATCH | `/api/monitors/:id` | Bearer | Update fields, pause or resume |
| DELETE | `/api/monitors/:id` | Bearer | Delete (cascades results) |
| GET | `/api/monitors/:id/results` | Bearer | Recent results |
| GET | `/api/monitors/:id/stats` | Bearer | 24h or 7d summary |
| POST | `/api/monitors/:id/check` | Bearer | Run a check now |

Every query on monitors must include `AND user_id = $currentUser`.

### 7.3 Endpoint Details

#### `GET /health`
`200 { "status": "ok", "db": "up", "uptimeSeconds": 1234, "version": "1.0.0" }`. If the DB ping fails, return `503 { "status": "degraded", "db": "down" }`.

#### `POST /api/auth/register`
Request: `{ "email": "a@b.com", "password": "at-least-10-chars" }`.
Validation: `email` is a valid email, max 254, trimmed. `password` is 10 to 72 characters.
`201 { "accessToken": "...", "user": { "id": "uuid", "email": "a@b.com" } }` plus the `Set-Cookie` header.

#### `POST /api/auth/login`
Same body. `200` with the same response shape as register. `401 INVALID_CREDENTIALS` on failure.

#### `POST /api/auth/refresh`
No body. Reads the `watcher_rt` cookie. `200 { "accessToken": "..." }` plus a rotated cookie. `401 UNAUTHORIZED` and a cleared cookie if the token is missing, invalid, expired, or reused.

#### `POST /api/auth/logout`
`204`, no body. Always clears the cookie, even if the token is unknown.

#### `GET /api/auth/me`
`200 { "user": { "id": "uuid", "email": "a@b.com" } }`

#### `POST /api/monitors`
Request:
```json
{ "name": "Payments API", "url": "https://api.example.com/health", "method": "GET",
  "intervalSeconds": 300, "expectedStatusCode": 200, "timeoutMs": 10000 }
```
Validation:
- `name`: 1 to 100 characters, trimmed
- `url`: passes the SSRF rules (section 6.4)
- `method`: `GET` or `HEAD` (default `GET`)
- `intervalSeconds`: one of `60, 300, 600, 900, 1800, 3600` (default 300). Must be at least `MIN_INTERVAL_SECONDS`.
- `expectedStatusCode`: integer 100 to 599 (default 200)
- `timeoutMs`: integer 1000 to 30000 (default 10000)

Behavior: enforce `MAX_MONITORS_PER_USER` (409 `MONITOR_LIMIT_REACHED`). Insert with `next_check_at = now()` so the first check runs on the next tick. Return `201 { "monitor": {...} }`.

#### `GET /api/monitors`
`200 { "monitors": [ ... ] }`, ordered by `created_at DESC`. No pagination in V1 (capped at 10 per user).

#### `GET /api/monitors/:id`
`200 { "monitor": {...} }`. `:id` must be a UUID, otherwise `400 VALIDATION_ERROR`.

#### `PATCH /api/monitors/:id`
Body: any subset of `name, url, method, intervalSeconds, expectedStatusCode, timeoutMs, isActive` (at least one field; `.strict()`).
Behavior: re-validate `url` if present. If `isActive` goes `false → true`, set `next_check_at = now()`. If the interval changes, set `next_check_at = LEAST(next_check_at, now() + new interval)`. Always set `updated_at = now()`. `200 { "monitor": {...} }`.

#### `DELETE /api/monitors/:id`
`204`. `404` if not found or not owned.

#### `GET /api/monitors/:id/results`
Query: `limit` (1 to 500, default 100), `before` (optional ISO timestamp; returns results strictly older than it).
`200 { "results": [ ... ] }`, ordered by `checked_at DESC`.

#### `GET /api/monitors/:id/stats`
Query: `window` is `24h` (default) or `7d`.
`200`:
```json
{ "window": "24h", "totalChecks": 288, "failedChecks": 3, "uptimePercent": 98.96, "avgResponseTimeMs": 151 }
```
`uptimePercent` is `null` when `totalChecks = 0`, otherwise rounded to 2 decimals. `avgResponseTimeMs` averages only checks that have a response time, and is `null` if there are none.

#### `POST /api/monitors/:id/check`
Runs `runCheck` immediately, records the result through `recordResult`, and **does not** change `next_check_at`. Rate limited per user. Works on paused monitors. `200 { "result": {...}, "monitor": {...} }`.

---

## 8. Scheduler, Checker, and Retention

### 8.1 Scheduler (`src/scheduler/scheduler.ts`)
- Starts after the HTTP server listens, only if `SCHEDULER_ENABLED=true`.
- Runs `tick()` every `SCHEDULER_TICK_SECONDS` (default 10), starting at boot. Use a **non-overlapping** loop: schedule the next tick only after the current one finishes, or guard with an `isRunning` flag.
- `tick()` does the following:
  1. `claimDueMonitors(limit=50)` using the atomic SQL in section 4.3.
  2. Run `checkAndRecord(monitor)` for each claimed monitor using `p-limit(CHECK_CONCURRENCY)`.
  3. Catch and log errors per monitor. One failure must never stop the others.
- On `SIGTERM` or `SIGINT`: stop scheduling new ticks, wait for in-flight checks (up to 10 seconds), close the HTTP server, end the pool, and exit 0.

### 8.2 Checker (`src/checker/runCheck.ts`)
```ts
type CheckOutcome = {
  status: 'up' | 'down';
  statusCode: number | null;
  responseTimeMs: number | null;
  error: string | null;
  checkedAt: Date;
};
runCheck(monitor: { url: string; method: 'GET'|'HEAD'; expectedStatusCode: number; timeoutMs: number }): Promise<CheckOutcome>
```
- Measures time with `performance.now()` from before the request until response headers arrive.
- Uses the SSRF-safe agent (section 6.4). Sets the header `User-Agent: WatcherBot/1.0 (+uptime-monitor)`.
- Maps errors to short strings: timeout, DNS failure, connection refused, TLS error, blocked address, or `Expected X, got Y`.
- Never throws. It always returns an outcome.

### 8.3 Recording (`recordResult` in `result.service.ts`)
In a single transaction:
1. `INSERT INTO check_results (...)`.
2. `UPDATE monitors SET current_status, last_checked_at, last_response_time_ms, last_status_code, last_error, consecutive_failures = (CASE WHEN up THEN 0 ELSE consecutive_failures + 1 END), updated_at = now() WHERE id = $1`.

### 8.4 Retention (`src/scheduler/retention.ts`)
Every hour, run `DELETE FROM check_results WHERE checked_at < now() - ($1 || ' days')::interval` with `RESULT_RETENTION_DAYS` (default 7). Delete in batches of 5000 rows until none remain, so the Neon free tier does not fill up.

---

## 9. Environment Variables

### 9.1 `backend/.env.example`

```dotenv
# ---------- Server ----------
NODE_ENV=development              # development | production | test
PORT=8080
LOG_LEVEL=info                    # fatal | error | warn | info | debug
# Number of reverse proxies in front of the app (see PRD 9.3)
TRUST_PROXY=0                     # local: 0 | Render direct: 1 | Render behind Vercel rewrite: usually 2

# ---------- Database ----------
# Local (docker-compose.yml)
DATABASE_URL=postgres://watcher:watcher@localhost:5432/watcher
# Neon: use the POOLED string here for the running app, with ?sslmode=require
# DATABASE_URL=postgres://USER:PASSWORD@ep-xxxx-pooler.REGION.aws.neon.tech/watcher?sslmode=require
# Neon: use the DIRECT (non-pooled) string for migrations. Falls back to DATABASE_URL if empty.
DIRECT_DATABASE_URL=
DB_POOL_MAX=10

# ---------- Auth ----------
# Generate with: openssl rand -base64 48   (minimum 32 characters)
JWT_ACCESS_SECRET=change-me-to-a-long-random-string-at-least-32-chars
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL_DAYS=7
BCRYPT_COST=12                    # use 4 in tests only

# ---------- Cookies / CORS ----------
COOKIE_SECURE=false               # true in production (HTTPS)
COOKIE_SAMESITE=lax               # lax (default, via Vercel proxy) | none (only if calling Render directly cross-site)
COOKIE_DOMAIN=                    # leave empty
# Comma-separated list of allowed browser origins
CORS_ORIGINS=http://localhost:5173

# ---------- Monitoring behaviour ----------
SCHEDULER_ENABLED=true
SCHEDULER_TICK_SECONDS=10
CHECK_CONCURRENCY=10
MIN_INTERVAL_SECONDS=60
MAX_MONITORS_PER_USER=10
DEFAULT_TIMEOUT_MS=10000
RESULT_RETENTION_DAYS=7

# ---------- Safety ----------
# NEVER true in production. Allows monitoring localhost/private IPs for local testing.
ALLOW_PRIVATE_TARGETS=false
```

Production values on Render: `NODE_ENV=production`, `COOKIE_SECURE=true`, `CORS_ORIGINS=https://<your-app>.vercel.app`, a strong `JWT_ACCESS_SECRET`, the Neon URLs, and `LOG_LEVEL=info`.

### 9.2 `frontend/.env.example`

```dotenv
# All VITE_* variables are PUBLIC and baked into the bundle. Never put secrets here.

# Base URL the SPA uses for API calls.
# "/api" = same-origin (Vite dev proxy locally, Vercel rewrite in production). Recommended.
# Use a full URL (https://xxx.onrender.com/api) only if you skip the rewrite;
# then set COOKIE_SAMESITE=none on the backend and expect third-party-cookie issues in some browsers.
VITE_API_BASE_URL=/api

VITE_APP_NAME=Watcher
VITE_APP_TAGLINE=Your APIs. Always in Sight.

# Dev only: read by vite.config.ts (not exposed to the browser), the backend the dev proxy targets
VITE_DEV_PROXY_TARGET=http://localhost:8080
```

### 9.3 Notes
- **Vercel rewrite** (`frontend/vercel.json`). The rewrite destination cannot read env vars, so the Render URL is hard-coded here. Order matters: the API rule comes first.
  ```json
  {
    "rewrites": [
      { "source": "/api/:path*", "destination": "https://YOUR-SERVICE.onrender.com/api/:path*" },
      { "source": "/(.*)", "destination": "/index.html" }
    ]
  }
  ```
- **Trust proxy:** behind Vercel's rewrite and then Render's load balancer, `req.ip` may resolve to a proxy address if `TRUST_PROXY` is wrong, which would make all users share one rate-limit bucket. After deploying, log `req.ip` and the `x-forwarded-for` header once and adjust `TRUST_PROXY` (1 or 2) until `req.ip` is the real client IP.
- **Neon:** use the direct (non-pooled) URL for migrations, because `node-pg-migrate` takes an advisory lock that does not work reliably through a transaction-mode pooler.
- **Render free tier:** the service sleeps after roughly 15 minutes without inbound traffic, and the in-process scheduler stops while it sleeps. Document this in the README. Optionally ping `/health` every 10 minutes from a free external cron service (check Render's current terms) to keep it awake.

---

## 10. Frontend Specification

### 10.1 Routes
| Path | Page | Access |
|---|---|---|
| `/login` | Login | Public (redirect to `/dashboard` if logged in) |
| `/register` | Register | Public (same redirect) |
| `/dashboard` | Monitor list, "Add monitor" | Protected |
| `/monitors/:id` | Monitor detail | Protected |
| `*` | Not found | Public |
| `/` | Redirect to `/dashboard` | n/a |

### 10.2 Auth Handling
- `AuthContext` holds `{ user, accessToken, status: 'loading' | 'authenticated' | 'anonymous' }`.
- On app start, call `POST /auth/refresh` (with `withCredentials: true`). Show a full-page loader until it resolves.
- `api/client.ts`: an axios instance with `baseURL = import.meta.env.VITE_API_BASE_URL`, `withCredentials: true`, a request interceptor that adds the bearer token, and a response interceptor that on 401 performs a **single shared** refresh and retries once. If that fails, clear the auth state and redirect to `/login`.
- `ProtectedRoute` redirects anonymous users to `/login`.
- Logout calls `POST /auth/logout`, clears the state and the React Query cache, and redirects.

### 10.3 Pages and Components

**Login / Register:** centered card, email and password fields with zod validation (mirror the backend rules), inline server errors, and a link to the other page. Show the Watcher name and tagline.

**Dashboard:**
- Header: logo, tagline, user email, Logout.
- Summary strip: counts of Up, Down, Paused, Pending.
- Responsive grid of `MonitorCard`s: name, URL (truncated), `StatusBadge`, last response time, "checked X ago", interval. Clicking opens the detail page.
- "Add monitor" button opens a modal with `MonitorForm`.
- Empty state: "No monitors yet. Add your first API."
- Data from `useQuery(['monitors'])` with `refetchInterval: 15000`.

**Monitor detail:**
- Header: name, URL, `StatusBadge`, and buttons: **Check now**, **Pause/Resume**, **Edit**, **Delete** (with a confirm dialog).
- Stats row from `/stats` with a 24h/7d toggle: uptime %, average response time, total checks, failed checks.
- `LatencyChart` (recharts line chart) of the last 100 results, plotted oldest to newest. Down checks are shown as red points or gaps.
- Table of the last 20 checks: time, status, code, response time, error.
- Polls every 15 seconds.

**`StatusBadge`:** `up` is green, `down` is red, `pending` is gray, `paused` is amber. Always include a text label, not color alone.

**`MonitorForm`:** fields name, URL, method, interval (select), expected status, timeout. The server's `URL_NOT_ALLOWED` and `MONITOR_LIMIT_REACHED` errors appear inline.

### 10.4 UX Requirements
- Loading skeletons, error states with Retry, and toast notifications for create, update, and delete.
- Relative timestamps ("12s ago") with the absolute time in a tooltip.
- Responsive from 360px wide upward.
- Visual style: clean, dark-friendly, one accent color. Use Tailwind only (no component library).

---

## 11. Non-Functional Requirements
- **Reliability:** a failing check or a thrown error must never crash the process. Register `unhandledRejection` and `uncaughtException` handlers that log and exit (Render restarts the service).
- **Performance:** `GET /api/monitors` under 100 ms on Neon. Index usage as defined in section 5.
- **Observability:** structured JSON logs (pino). One log line per check: `monitorId, status, statusCode, responseTimeMs`. Never log passwords, tokens, or cookies.
- **Code quality:** TypeScript strict, ESLint and Prettier configured, no `any` without a comment, small modules.
- **Time:** all stored and API timestamps are UTC ISO-8601. The frontend formats them in local time.

---

## 12. Testing Requirements (minimum for V1)
Backend (vitest):
1. `ssrf.ts`: rejects `http://localhost`, `http://127.0.0.1`, `http://169.254.169.254`, `http://10.0.0.1`, `http://[::1]`, `http://[::ffff:127.0.0.1]`, `ftp://x`, and URLs with credentials. Accepts `https://example.com`.
2. `runCheck`: marks up on a matching status, down on a mismatched status, down on timeout. Use a local `http` test server with `ALLOW_PRIVATE_TARGETS=true`.
3. Auth (supertest against a test database): register, login, `me`, refresh rotation, reuse of an old refresh token revokes the family, logout.
4. Monitors: CRUD works, a user cannot read, update, or delete another user's monitor (404), and the monitor limit is enforced.
5. `recordResult`: updates `consecutive_failures` correctly (increments on down, resets on up).

Frontend: a manual test checklist is enough for V1 (see `implementation.md`).

---

## 13. Deployment Requirements

| Piece | Setup |
|---|---|
| **Neon** | Create a project and database `watcher`. Copy the pooled and direct connection strings. |
| **Render** | Web service from the repo, root directory `backend`. Build: `npm ci && npm run build`. Start: `npm run start:prod` (runs migrations with `DIRECT_DATABASE_URL`, then `node dist/server.js`). Health check path `/health`. Set the env vars from section 9.1. |
| **Vercel** | Import the repo, root directory `frontend`, framework Vite. Set `VITE_*` variables. Commit `vercel.json` with the Render URL. |
| **Order** | Neon, then Render (get its URL), then put that URL into `vercel.json`, then Vercel, then set `CORS_ORIGINS` on Render to the Vercel URL and redeploy. |

`package.json` scripts (backend): `dev` (`tsx watch src/server.ts`), `build` (`tsc -p .`), `start` (`node dist/server.js`), `migrate` (`node-pg-migrate up`), `start:prod` (`npm run migrate && npm start`), `test` (`vitest run`), `lint`.

`docker-compose.yml` (local):
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
volumes:
  pgdata:
```

---

## 14. Acceptance Criteria (Definition of Done)

1. `docker compose up -d db`, then `npm run migrate`, then `npm run dev` in `backend` and `npm run dev` in `frontend` gives a working app at `http://localhost:5173`.
2. A new user can register, log out, and log in again. Reloading the page keeps the user logged in. Logging out ends the session.
3. Creating a monitor for `https://example.com` shows `pending`, then `up` within about 15 seconds, with a response time.
4. Creating a monitor for `https://httpstat.us/503` (or any URL that returns 503) with expected status 200 shows `down` with an error such as `Expected 200, got 503`.
5. Creating a monitor for `http://localhost:8080`, `http://169.254.169.254`, or `http://127.0.0.1` is rejected with `URL_NOT_ALLOWED` (with `ALLOW_PRIVATE_TARGETS=false`).
6. A second user cannot see, fetch, edit, or delete the first user's monitors (404s).
7. Pausing a monitor stops new results. Resuming triggers a check within one tick.
8. The detail page shows the latency chart, stats, and recent checks, and updates without a manual reload.
9. Entering the wrong password 11 times from one IP returns `429`.
10. Stopping the backend with Ctrl+C exits cleanly with no unhandled errors.
11. `npm test` passes in `backend`.
12. The deployed app works end to end: Vercel URL, register, add monitor, see results from the Render service stored in Neon. The README documents the Render cold-start behavior and links to the live URL.
13. Repo is committed and tagged `v1`.

---

## 15. Risks and Decisions

| Risk or decision | Mitigation |
|---|---|
| Render free tier sleeps, so checks pause | Document it. Optional external ping on `/health`. Accept for V1. |
| Neon free storage limit | Retention job (7 days), limit of 10 monitors per user, minimum interval 60 seconds. |
| SSRF | Section 6.4. Covered by tests. |
| Cross-site cookie issues between Vercel and Render | Vercel rewrite keeps cookies first-party. |
| Rate-limit state is in memory, so it resets on restart and is per instance | Acceptable for V1. Moves to Redis in V2. |
| Single-process scheduler | Safe claiming (`SKIP LOCKED`) already allows multiple instances. Splitting into its own process comes in V2. |
