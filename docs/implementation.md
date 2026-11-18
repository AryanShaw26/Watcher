# Watcher V1: Implementation Plan

> **Your APIs. Always in Sight.**

Companion to `PRD.md`. The PRD says **what** to build. This file says **in what order**, and how to check each step before moving on.

## How to use this with an AI agent

1. Put `PRD.md` and this file in `docs/` of the repo so the agent can read them.
2. Start the agent session with this **master prompt**:

   > Read `docs/PRD.md` fully. It is the source of truth for Watcher Version 1. We will build it step by step following `docs/implementation.md`. Do only the step I name. Use the exact file names, routes, columns, and env vars from the PRD. Don't add features from the "Out of Scope" list. After each step, tell me how to verify it.

3. Then send one step at a time: *"Do Step N from implementation.md."*
4. Run the **Verify** block yourself. Do not move on until it passes.
5. **Commit after every step** (`git commit -m "step N: ..."`). If the agent breaks something, you can roll back.
6. Read what the agent wrote. You will be asked about it in interviews.

**Time budget (about one day of focused work):**

| Block | Steps | Rough time |
|---|---|---|
| Foundation | 0 to 3 | 1.5 h |
| Auth | 4 to 5 | 1.5 h |
| Monitors and checking | 6 to 9 | 2.5 h |
| Tests | 10 | 45 min |
| Frontend | 11 to 14 | 3 h |
| Deploy and finish | 15 to 17 | 1.5 h |

---

## Step 0: Prerequisites

**Do this yourself (no agent needed):**
- Install Node.js 20 LTS, Git, Docker Desktop.
- Create accounts: GitHub, Neon, Render, Vercel.
- Create an empty GitHub repo named `watcher`.

**Verify**
```bash
node -v          # v20.x
docker --version
git --version
```

---

## Step 1: Repository scaffold and local database

**Goal:** the folder structure from PRD 4.5 and a running local Postgres.

**Tasks**
1. Create the folders: `backend/`, `frontend/`, `docs/`. Copy `PRD.md` and `implementation.md` into `docs/`.
2. Add a root `.gitignore` (node_modules, dist, `.env`, `.env.*.local`, `.DS_Store`, coverage).
3. Add `docker-compose.yml` exactly as in PRD section 13.
4. Add a short `README.md` placeholder (title, tagline, "work in progress").

**Verify**
```bash
docker compose up -d db
docker compose ps                      # db is "healthy"
docker compose exec db psql -U watcher -d watcher -c "select 1;"
```

**Commit:** `step 1: scaffold and docker postgres`

---

## Step 2: Backend bootstrap

**Goal:** a TypeScript Express server with validated config, logging, error handling, and `/health`. No database logic yet beyond the pool.

**Tasks**
1. In `backend/`, run `npm init -y`. Set `"type": "module"`.
2. Install:
   ```bash
   npm i express cors helmet cookie-parser express-rate-limit zod pg pino pino-http \
         bcryptjs jsonwebtoken undici ipaddr.js p-limit node-pg-migrate dotenv
   npm i -D typescript tsx vitest supertest @types/node @types/express @types/cors \
            @types/cookie-parser @types/pg @types/bcryptjs @types/jsonwebtoken \
            @types/supertest eslint prettier
   ```
3. `tsconfig.json`: `strict: true`, `module` and `moduleResolution` `NodeNext`, `target` ES2022, `outDir` `dist`, `rootDir` `src`.
4. Add the npm scripts from PRD section 13.
5. Create `backend/.env.example` exactly as PRD 9.1, then copy it to `.env`.
6. `src/config/env.ts`: load dotenv, validate every variable with zod (coerce numbers and booleans, apply defaults), and exit with a readable error on failure. Enforce `JWT_ACCESS_SECRET` of at least 32 characters.
7. `src/lib/logger.ts`: pino with the redaction list from PRD 6.3 (item 9).
8. `src/lib/errors.ts`: `AppError(status, code, message, details?)` and the error code list from PRD 7.1.
9. `src/db/pool.ts`: a `pg.Pool` from `DATABASE_URL` (SSL enabled when the URL contains `sslmode=require`), plus a `withTransaction(fn)` helper.
10. `src/middleware/errorHandler.ts`: converts `AppError` and `ZodError` to the PRD error format. Unknown errors become a logged `500 INTERNAL`. Also add a 404 handler for unknown routes.
11. `src/app.ts`: builds and exports the app with `helmet`, `cors` (allowlist, credentials), `express.json({limit:'10kb'})`, `cookie-parser`, `pino-http`, trust proxy, and `GET /health` (DB ping, 503 if down).
12. `src/server.ts`: starts listening. Add a graceful shutdown stub (`SIGTERM` and `SIGINT` close the server and the pool) and `unhandledRejection` handlers.

**Verify**
```bash
cd backend && npm run dev
curl -i localhost:8080/health          # 200 {"status":"ok","db":"up",...}
curl -i localhost:8080/nope            # 404 in the PRD error format
# Stop postgres -> /health returns 503; start it again -> 200
JWT_ACCESS_SECRET=short npm run dev    # must exit with a clear config error
```

**Commit:** `step 2: backend bootstrap`

---

## Step 3: Database migrations

**Goal:** all four tables exist, created by migrations.

**Tasks**
1. Create `backend/migrations/` with the four SQL files **exactly** as in PRD 5.2.
2. Configure `node-pg-migrate` to use SQL files, with the connection string from `DIRECT_DATABASE_URL`, falling back to `DATABASE_URL` (a small wrapper script or `--database-url-var` is fine).
3. Run the migrations.

**Verify**
```bash
npm run migrate
docker compose exec db psql -U watcher -d watcher -c "\dt"
# users, refresh_tokens, monitors, check_results, pgmigrations
docker compose exec db psql -U watcher -d watcher -c "\d monitors"
# Check: indexes monitors_user_idx, monitors_due_idx, and the CHECK constraints
npx node-pg-migrate down 1 && npm run migrate     # down and up both work
```

**Commit:** `step 3: database schema`

---

## Step 4: Authentication

**Goal:** register, login, refresh with rotation and reuse detection, logout, and `me`, as in PRD section 6 and 7.3.

**Tasks**
1. `src/lib/tokens.ts`:
   - `signAccessToken(userId)` and `verifyAccessToken(token)` (HS256, explicit `algorithms`).
   - `generateRefreshToken()` returns a raw token (48 bytes, base64url). `hashToken(raw)` returns SHA-256 hex.
2. `modules/auth/auth.schemas.ts`: zod schemas for register and login (`.strict()`).
3. `modules/auth/auth.service.ts` (no Express imports):
   - `register(email, password)`: hash with bcryptjs, insert, handle the unique violation as `EMAIL_TAKEN`, create a session.
   - `login(email, password)`: look up with `lower(email)`. Always run a bcrypt compare (dummy hash if the user is missing). Return `INVALID_CREDENTIALS` on failure.
   - `createSession(userId)`: new `family_id`, store the hashed refresh token.
   - `rotateRefreshToken(raw)`: find by hash. If it is missing, revoked, or expired, revoke the whole family (when known) and throw `UNAUTHORIZED`. Otherwise revoke it, insert a new token in the same family, and return the new raw token and `userId`.
   - `revokeFamilyByToken(raw)` for logout.
4. `modules/auth/auth.routes.ts`:
   - Set and clear the `watcher_rt` cookie with the options from PRD 6.1 (`HttpOnly`, `Secure` from env, `SameSite` from env, `Path=/api/auth`, `Max-Age`).
   - Origin check on `/refresh` and `/logout` (PRD 6.3 item 8).
   - Routes: `POST /register`, `/login`, `/refresh`, `/logout`, and `GET /me` (protected, built in Step 5).
5. Mount at `/api/auth` in `app.ts`.

> `GET /me` needs `requireAuth` from Step 5. Build the middleware first in this step if you prefer. It is small.

**Verify** (use `curl -c cookies.txt -b cookies.txt`)
```bash
# register
curl -i -c c.txt -H 'content-type: application/json' \
  -d '{"email":"me@test.com","password":"correct-horse-battery"}' localhost:8080/api/auth/register
# expect 201, accessToken in the body, Set-Cookie: watcher_rt=...; HttpOnly; Path=/api/auth

# login with a wrong password -> 401 INVALID_CREDENTIALS (same message as an unknown email)
# refresh -> 200 with a new accessToken and a NEW cookie value
curl -i -b c.txt -c c.txt -X POST localhost:8080/api/auth/refresh
# reuse the OLD cookie value -> 401, and afterwards the newest token also fails (family revoked)
# logout -> 204 and the cookie is cleared
```
Check in psql: `select token_hash, revoked_at from refresh_tokens;` shows hashes (not raw tokens) and revoked rows.

**Commit:** `step 4: authentication`

---

## Step 5: Auth middleware and security hardening

**Goal:** protect routes and add the remaining security controls.

**Tasks**
1. `middleware/auth.ts`: `requireAuth` reads `Authorization: Bearer`, verifies the JWT, and sets `req.userId`. Failure gives `401 UNAUTHORIZED`. Add the type augmentation for `req.userId`.
2. `middleware/validate.ts`: `validate({ body?, query?, params? })` using zod, replacing the request values with the parsed ones.
3. `middleware/rateLimit.ts`: the four limiters from PRD 6.3 item 7 (`express-rate-limit`, `standardHeaders: true`). Return the standard error format with `RATE_LIMITED`. The per-user limiter keys on `req.userId`.
4. Apply: the global `/api` limiter, the login limiter, and the register limiter.
5. `GET /api/auth/me` implemented and protected.

**Verify**
```bash
curl -i localhost:8080/api/auth/me                                   # 401
curl -i -H "authorization: Bearer $TOKEN" localhost:8080/api/auth/me # 200
curl -i -H "authorization: Bearer garbage" localhost:8080/api/auth/me # 401
# Send 11 bad logins quickly -> the 11th returns 429 RATE_LIMITED
for i in $(seq 1 11); do curl -s -o /dev/null -w "%{http_code}\n" -H 'content-type: application/json' \
  -d '{"email":"x@y.com","password":"wrong-password-1"}' localhost:8080/api/auth/login; done
```

**Commit:** `step 5: auth middleware and rate limits`

---

## Step 6: Monitors CRUD

**Goal:** the monitor endpoints from PRD 7.3, scoped to the owner.

**Tasks**
1. `lib/ssrf.ts` **URL validation part only** for now: scheme, length, credentials, blocked hostnames, and a resolve-and-check function `assertPublicUrl(url)` using `dns.promises.lookup(host, { all: true })` and `ipaddr.js` (allow only `range() === 'unicast'`, normalize IPv4-mapped IPv6). Honor `ALLOW_PRIVATE_TARGETS`. Throw `AppError(400, 'URL_NOT_ALLOWED', ...)`.
2. `modules/monitors/monitor.schemas.ts`: create and patch schemas (`.strict()`, patch needs at least one field), and a UUID param schema.
3. `modules/monitors/monitor.service.ts` (plain functions, taking `userId` explicitly):
   `createMonitor`, `listMonitors`, `getMonitor`, `updateMonitor`, `deleteMonitor`. Every SQL statement includes `AND user_id = $n`. A row mapper converts snake_case to the camelCase monitor object. Enforce `MAX_MONITORS_PER_USER`. Apply the PATCH behaviors from PRD 7.3 (resume triggers an immediate check, interval change adjusts `next_check_at`).
4. `modules/monitors/monitor.routes.ts` with `requireAuth` on the whole router. Mount at `/api/monitors`.
5. Leave `/results`, `/stats`, and `/check` for Step 9.

**Verify** (with two users, A and B)
```bash
# A creates a monitor -> 201
# A lists -> contains it. B lists -> empty.
# B GET/PATCH/DELETE A's monitor id -> 404
# Create with url=http://127.0.0.1 -> 400 URL_NOT_ALLOWED
# Create with url=http://169.254.169.254/latest/meta-data -> 400 URL_NOT_ALLOWED
# Create with url=ftp://example.com -> 400
# Create an 11th monitor -> 409 MONITOR_LIMIT_REACHED
# PATCH {"isActive": false} -> isActive false. PATCH with an unknown field -> 400
```

**Commit:** `step 6: monitors crud`

---

## Step 7: SSRF-safe checker

**Goal:** `runCheck()` as specified in PRD 8.2, with connect-time SSRF enforcement.

**Tasks**
1. In `lib/ssrf.ts`, add `createSafeAgent()`: an `undici` `Agent` whose `connect.lookup` resolves the hostname, rejects the connection if **any** address is non-public (unless `ALLOW_PRIVATE_TARGETS`), and handles both lookup callback signatures (single address and the `all: true` array form).
2. `checker/runCheck.ts`:
   - Input: `{ url, method, expectedStatusCode, timeoutMs }`. Output: `CheckOutcome` (PRD 8.2).
   - `undici.request(url, { method, dispatcher: safeAgent, maxRedirections: 0, headersTimeout: timeoutMs, bodyTimeout: timeoutMs, signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'WatcherBot/1.0 (+uptime-monitor)' } })`.
   - Time with `performance.now()` until headers arrive. Destroy or discard the body (`body.destroy()` or `await body.dump()`).
   - Map errors to the short strings listed in the PRD. **Never throw.**
3. A tiny script `npm run check:try -- <url>` that runs `runCheck` against a URL and prints the outcome (handy for debugging).

**Verify**
```bash
npm run check:try -- https://example.com           # up, ~100-500ms
npm run check:try -- https://example.com/definitely-404   # down: Expected 200, got 404
npm run check:try -- http://127.0.0.1:8080/health  # down: Blocked ... (with ALLOW_PRIVATE_TARGETS=false)
npm run check:try -- https://10.255.255.1          # timeout error after timeoutMs
npm run check:try -- https://nonexistent.invalid   # DNS lookup failed
```

**Commit:** `step 7: ssrf-safe checker`

---

## Step 8: Scheduler, recording, and retention

**Goal:** monitors are checked automatically and results are stored.

**Tasks**
1. `modules/results/result.service.ts`: `recordResult(monitor, outcome)` as in PRD 8.3, in one transaction.
2. `scheduler/scheduler.ts`:
   - `claimDueMonitors(limit)` using the single atomic `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING *` statement from PRD 4.3.
   - `tick()`: claim, then `pLimit(CHECK_CONCURRENCY)` over `checkAndRecord(monitor)`. Per-monitor `try/catch` with logging. Log one line per check.
   - `startScheduler()` and `stopScheduler()`: a non-overlapping loop, only started when `SCHEDULER_ENABLED=true`. `stopScheduler()` waits for in-flight work (10 s cap).
3. `scheduler/retention.ts`: hourly batched delete per PRD 8.4. Also run once at boot.
4. Wire both into `server.ts` after `listen`, and into graceful shutdown.

**Verify**
```bash
npm run dev
# With a monitor for https://example.com (interval 60), watch the logs:
#   one "check" log line about every 60s
docker compose exec db psql -U watcher -d watcher -c \
 "select status,status_code,response_time_ms,checked_at from check_results order by id desc limit 5;"
docker compose exec db psql -U watcher -d watcher -c \
 "select name,current_status,consecutive_failures,last_checked_at,next_check_at from monitors;"
# Pause the monitor (PATCH isActive false) -> no new rows. Resume -> a new row within ~10s.
# Create a monitor for a URL that returns 503 -> current_status 'down', consecutive_failures increments.
# Ctrl+C -> clean shutdown message, process exits 0.
# Optional: start a second backend on PORT=8081 -> each monitor is still checked once per interval (no duplicates).
```

**Commit:** `step 8: scheduler and results`

---

## Step 9: Results, stats, and manual check

**Goal:** the remaining three monitor endpoints.

**Tasks**
1. `GET /api/monitors/:id/results`: ownership check first (404), then the query with `limit` and optional `before`, ordered `checked_at DESC`. Map rows to the camelCase result object.
2. `GET /api/monitors/:id/stats?window=24h|7d`: one SQL query (`count(*)`, `count(*) filter (where status='down')`, `avg(response_time_ms)`) over `checked_at >= now() - interval`. Compute `uptimePercent` per PRD 7.3.
3. `POST /api/monitors/:id/check`: ownership check, `assertPublicUrl`, `runCheck`, `recordResult`, return `{ result, monitor }`. Apply the per-user limiter. Do not change `next_check_at`.

**Verify**
```bash
curl -H "authorization: Bearer $T" "localhost:8080/api/monitors/$ID/results?limit=5"
curl -H "authorization: Bearer $T" "localhost:8080/api/monitors/$ID/results?limit=1000"   # 400 (max 500)
curl -H "authorization: Bearer $T" "localhost:8080/api/monitors/$ID/stats?window=24h"
curl -X POST -H "authorization: Bearer $T" localhost:8080/api/monitors/$ID/check          # result returned, row inserted
# 11 manual checks within a minute -> 429
# User B calling any of these on A's monitor -> 404
```

**Commit:** `step 9: results, stats, manual check`

---

## Step 10: Backend tests

**Goal:** the test list from PRD section 12.

**Tasks**
1. `vitest.config.ts`. Use a separate database (`watcher_test`) created in the same Docker Postgres. A global setup runs migrations. Tests truncate tables between runs. Set `BCRYPT_COST=4` and `ALLOW_PRIVATE_TARGETS=false` by default in the test env.
2. Write the tests:
   - `ssrf.test.ts`: the reject list and the accept case from PRD 12.
   - `runCheck.test.ts`: a local `http.createServer` returning 200, 503, and a slow response (set `ALLOW_PRIVATE_TARGETS=true` for this file only).
   - `auth.test.ts` (supertest): register, login, `me`, refresh rotation, reuse detection, logout.
   - `monitors.test.ts`: CRUD, cross-user 404, limit enforcement.
   - `recordResult.test.ts`: `consecutive_failures` increments and resets.

**Verify**
```bash
npm test      # all green
```

**Commit:** `step 10: backend tests`

---

## Step 11: Frontend scaffold

**Goal:** a Vite React app with Tailwind, routing, and the API client.

**Tasks**
1. In `frontend/`: `npm create vite@latest . -- --template react-ts`, then install:
   ```bash
   npm i react-router-dom @tanstack/react-query axios recharts react-hook-form zod @hookform/resolvers
   npm i -D tailwindcss@3 postcss autoprefixer
   npx tailwindcss init -p
   ```
2. Configure Tailwind (`content` globs) and add the directives to `index.css`.
3. `vite.config.ts`: dev server on 5173, with a proxy `'/api'` to `process.env.VITE_DEV_PROXY_TARGET` (use `loadEnv`).
4. Create `frontend/.env.example` exactly as PRD 9.2, and copy it to `.env`.
5. `src/lib/queryClient.ts`, `src/main.tsx` (QueryClientProvider, BrowserRouter), `src/App.tsx` with the route table from PRD 10.1 (placeholder pages).
6. `src/api/client.ts`: the axios instance (`baseURL`, `withCredentials`). The interceptors come in Step 12.
7. Add `vercel.json` per PRD 9.3 (use a placeholder Render URL for now).

**Verify**
```bash
npm run dev     # http://localhost:5173 loads with Tailwind styles
# Visit /login, /dashboard, /nope: placeholder pages / NotFound render
# In the browser console: fetch('/api/../health') is not needed; instead check the proxy:
curl -i localhost:5173/api/auth/me     # 401 from the backend through the proxy
```

**Commit:** `step 11: frontend scaffold`

---

## Step 12: Frontend authentication

**Goal:** login, register, session restore, silent refresh, logout.

**Tasks**
1. `auth/AuthContext.tsx` with the state in PRD 10.2. Keep the access token in memory (state plus a module-level getter for the axios interceptor). **No localStorage.**
2. `api/auth.ts`: `register`, `login`, `refresh`, `logout`, `me`.
3. `api/client.ts` interceptors:
   - request: attach `Authorization: Bearer`.
   - response: on 401 (excluding the auth endpoints themselves), call refresh **once** through a shared in-flight promise, retry the original request, and on failure clear the auth state and navigate to `/login`.
4. On app start, call `refresh`. Show a loader until it settles.
5. `ProtectedRoute` and the redirect-if-authenticated wrapper for `/login` and `/register`.
6. `pages/Login.tsx` and `pages/Register.tsx` using react-hook-form and zod (email, password 10 to 72). Show server errors inline. Show the Watcher name and tagline.
7. A minimal Dashboard placeholder with the user email and a Logout button.

**Verify (manual)**
- Register, land on the dashboard. Reload the page: still logged in.
- DevTools, Application tab: `watcher_rt` cookie is `HttpOnly`, and there is **nothing** in localStorage or sessionStorage.
- Logout redirects to `/login`. Visiting `/dashboard` while logged out redirects to `/login`.
- Wrong password shows an inline error. Short password is blocked client-side.
- Temporarily set `ACCESS_TOKEN_TTL=20s` in the backend `.env`, wait 25 seconds, then trigger an API call (the monitors fetch in Step 13): it must succeed via a silent refresh. Set it back to `15m`.

**Commit:** `step 12: frontend auth`

---

## Step 13: Dashboard and monitor detail

**Goal:** the product UI from PRD 10.3.

**Tasks**
1. `api/monitors.ts`: typed functions for list, get, create, update, delete, results, stats, and manual check. Define the TypeScript types for `Monitor`, `CheckResult`, and `Stats` from the PRD.
2. `components/StatusBadge.tsx`: up, down, pending, and paused (derive paused from `!isActive`).
3. `components/MonitorCard.tsx` and the **Dashboard page**: summary strip, grid, empty state, skeletons, `refetchInterval: 15000`.
4. `components/MonitorForm.tsx` in a modal, used for create and edit. Map `URL_NOT_ALLOWED` and `MONITOR_LIMIT_REACHED` to inline errors. Use `useMutation` and invalidate `['monitors']`.
5. **Monitor detail page**:
   - Header with the actions: Check now, Pause/Resume, Edit, Delete (confirm dialog).
   - Stats row with a 24h/7d toggle.
   - `components/LatencyChart.tsx`: recharts `LineChart` of the last 100 results reversed to oldest-first. Mark down checks in red.
   - Table of the last 20 results.
   - Polling every 15 seconds.
6. `lib/format.ts`: relative time ("12s ago") and a duration formatter. Toasts for success and error (a small custom component is enough).
7. Make the layout responsive (check at 360px width).

**Verify (manual checklist)**
- [ ] Add `https://example.com`: badge goes pending, then up within ~15 s with a response time.
- [ ] Add a monitor that returns 503 (expected 200): badge is down with the error text.
- [ ] Adding `http://localhost:8080` shows the `URL_NOT_ALLOWED` message inline.
- [ ] Check now updates the table and chart without a reload.
- [ ] Pause shows the amber "Paused" badge, and no new results appear. Resume works.
- [ ] Edit changes the name and interval. Delete asks for confirmation and removes the card.
- [ ] Second account sees none of the first account's monitors. Opening a first-account monitor URL directly shows Not Found.
- [ ] The page looks fine on a phone-width viewport.

**Commit:** `step 13: dashboard and detail`

---

## Step 14: Containerize and full local run

**Goal:** make sure the backend builds as a production artifact.

**Tasks**
1. `backend/Dockerfile`: a multi-stage build on `node:20-alpine`: install, `npm run build`, then a runtime stage with production dependencies only, `dist/` and `migrations/`, running as a non-root user, `CMD ["npm","run","start:prod"]`.
2. `backend/.dockerignore` (node_modules, dist, `.env`, tests).
3. Build and run it against the compose Postgres.

**Verify**
```bash
cd backend
docker build -t watcher-api .
docker run --rm -p 8080:8080 --env-file .env \
  -e DATABASE_URL=postgres://watcher:watcher@host.docker.internal:5432/watcher watcher-api
curl localhost:8080/health
# The frontend dev server pointed at this container still works end to end.
```

**Commit:** `step 14: dockerfile`

---

## Step 15: Deploy: Neon, Render, Vercel

**Do these in order. Most of this is clicking in dashboards.**

### 15.1 Neon
1. Create a project and database `watcher`.
2. Copy two connection strings: **pooled** (host contains `-pooler`) and **direct**. Both need `?sslmode=require`.

### 15.2 Render (backend)
1. New, Web Service, connect the GitHub repo.
2. Root directory `backend`. Runtime Node. Build command `npm ci && npm run build`. Start command `npm run start:prod`. Health check path `/health`. Region near your Neon region.
3. Environment variables (PRD 9.1 production values):
   `NODE_ENV=production`, `PORT` (Render provides it, so do not hard-code), `DATABASE_URL` (pooled), `DIRECT_DATABASE_URL` (direct), `JWT_ACCESS_SECRET` (from `openssl rand -base64 48`), `COOKIE_SECURE=true`, `COOKIE_SAMESITE=lax`, `CORS_ORIGINS` (temporary placeholder), `TRUST_PROXY=2`, `ALLOW_PRIVATE_TARGETS=false`, and the rest of the defaults.
4. Deploy. Watch the logs: migrations run, and the server and scheduler start.

**Verify**
```bash
curl https://YOUR-SERVICE.onrender.com/health      # 200, db up
```

### 15.3 Vercel (frontend)
1. Edit `frontend/vercel.json` and put the real Render URL in the rewrite destination. Commit and push.
2. Import the repo in Vercel. Root directory `frontend`, framework Vite. Set `VITE_API_BASE_URL=/api`, `VITE_APP_NAME`, and `VITE_APP_TAGLINE`.
3. Deploy and copy the Vercel URL.

### 15.4 Close the loop
1. On Render, set `CORS_ORIGINS=https://YOUR-APP.vercel.app` (exact origin, no trailing slash). Redeploy.
2. Open the Vercel URL, register, and add a monitor.

**Verify (production)**
- Register works. Reload keeps you logged in (cookie is `Secure; HttpOnly`, and visible under the **Vercel** domain).
- A monitor for `https://example.com` becomes `up`.
- Rate limiting buckets: log `req.ip` and `x-forwarded-for` once (temporary log line). If `req.ip` is not your real IP, change `TRUST_PROXY` between 1 and 2, then remove the log line.
- Neon console, Tables: rows appear in `check_results`.

**Commit:** `step 15: deploy config`

---

## Step 16: Final polish and README

**Tasks**
1. **README.md** with: title and tagline, live demo link, what it does, tech stack, the Mermaid architecture diagram from the PRD, local setup (`docker compose up -d db`, migrations, both dev servers), env var table, security highlights (token design, SSRF protection, ownership checks), a **"Known limitations"** section (Render free tier sleeps and pauses checks, in-memory rate limiting, single process), and a **roadmap** (V2: Redis and Kafka, V3: alerts and analytics).
2. Add a screenshot or GIF of the dashboard.
3. Seed your own demo monitors on the live site: your own Render `/health`, `https://example.com`, and 2 or 3 reliable public APIs, so the dashboard has real data when someone opens it.
4. Optional keep-awake: a free external cron pinging `https://YOUR-SERVICE.onrender.com/health` every 10 minutes (check Render's current terms).

**Commit and tag**
```bash
git add -A && git commit -m "v1: working monitor"
git tag v1 && git push origin main --tags
```

---

## Step 17: Final acceptance check

Go through PRD section 14 line by line on the **deployed** app. Every item should pass.

**Quick interview-prep list.** You should be able to explain these without looking:
1. Why the access token lives in memory and the refresh token in an httpOnly cookie.
2. What refresh rotation and reuse detection protect against.
3. Why `FOR UPDATE SKIP LOCKED` lets several instances share the scheduler safely.
4. What SSRF is, and why checking the IP at connect time beats checking it once at creation (DNS rebinding).
5. Why `recordResult` is a separate function, and how V2 will use it.
6. Why the Vercel rewrite is used instead of calling Render directly from the browser.

---

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Backend exits at boot with a config error | Missing or short `JWT_ACCESS_SECRET`, or a bad `DATABASE_URL`. Read the zod message. |
| `self-signed certificate` or SSL error on Neon | The URL needs `?sslmode=require`, and the pool must enable SSL. |
| Migrations hang on Neon | You used the pooled URL. Use `DIRECT_DATABASE_URL`. |
| Login works but refresh fails after reload (prod) | Cookie not sent. Check that the SPA calls `/api` on its own origin, that `COOKIE_SECURE=true`, and that the cookie `Path` is `/api/auth`. |
| Browser CORS error | `CORS_ORIGINS` does not exactly match the origin (scheme, host, no trailing slash), or `credentials` is not enabled. |
| Everyone gets `429` quickly in production | Wrong `TRUST_PROXY`. All users look like one IP. See Step 15.4. |
| Monitors stop being checked on Render | The free instance went to sleep. Expected. Wake it or use the keep-awake ping. |
| Monitor for a valid public site shows "Blocked" | The DNS answer included a private address, or `lookup` callback signature handling is wrong. Test with `npm run check:try`. |
| Duplicate results per interval | Two instances without the atomic claim query. Confirm the single `UPDATE ... SKIP LOCKED` statement is used. |
