# Merge services/ into pool/ — TypeScript, single DB, unified dashboard

## Context

Pool and services are two separate Express apps with separate databases and deployments. Pool manages instance lifecycle (idle → claimed → destroyed). Services manages infrastructure (Railway, tool provisioning). Pool calls services over HTTP for only 3 operations. This adds deployment complexity, env var duplication, and two redundant dashboards for what is logically one system.

**Goal:** Single TypeScript package in `pool/` with services code as a subfolder, one Postgres database, one dashboard, one deployment.

## Phase 0: Convert pool to TypeScript

- Add `tsconfig.json` to pool (copy from services)
- Add devDeps: `typescript`, `tsx`, `@types/express`, `@types/node`, `@types/pg`
- Rename all `pool/src/**/*.js` → `.ts`
- Add minimal type annotations to make `tsc` pass (interfaces for DB row shapes, function params/returns)
- Update `package.json` scripts: `build: tsc`, `dev: tsx --watch`, `start: tsx src/index.ts`
- Update `pool/Dockerfile` to add `RUN pnpm build`, `CMD ["node", "dist/index.js"]`
- Verify: `pnpm build` passes, `pnpm test` passes

## Phase 1: Unified database

Single `DATABASE_URL` env var (falls back to `POOL_DATABASE_URL` for backward compat).

- Rewrite `pool/src/db/connection.ts` — single `pg.Pool` using `DATABASE_URL`
- Merge migrations into `pool/src/db/migrate.ts` — creates all 3 tables: `instances`, `instance_infra`, `instance_services` (idempotent, checks existence before CREATE)
- Keep `pool/src/db/pool.ts` for instances queries (unchanged)

**Deployment migration:** Use the services DB as target (already has 2 of 3 tables). Copy `instances` rows from pool DB into it. Set `DATABASE_URL` to what was `SERVICE_DATABASE_URL`. Run during maintenance window with `POOL_MIN_IDLE=0`.

## Phase 2: Move services code into pool

Target structure:
```
pool/src/
  index.ts                 — unified Express app
  config.ts                — merged config (pool + services env vars)
  types.ts                 — from services
  pool.ts                  — tick loop (direct function calls)
  provision.ts             — claim flow (unchanged)
  status.ts                — status helpers (unchanged)
  db/
    connection.ts          — single pg.Pool
    migrate.ts             — all 3 tables
    pool.ts                — instances queries
  services/
    infra.ts               — extracted business logic (createInstance, destroyInstance)
    status.ts              — extracted business logic (fetchBatchStatus)
    providers/
      railway.ts           — from services (360 lines)
      openrouter.ts        — from services (105 lines)
      agentmail.ts         — from services (54 lines)
      telnyx.ts            — from services (130 lines)
      wallet.ts            — from services (16 lines)
      env.ts               — from services (17 lines)
    routes/
      infra.ts             — thin Express wrappers calling services/infra.ts
      status.ts            — thin Express wrapper calling services/status.ts
      configure.ts         — from services
      tools.ts             — from services
      dashboard.ts         — from services (JSON endpoints)
      registry.ts          — from services
  middleware/
    auth.ts                — Bearer token check (POOL_API_KEY)
    session.ts             — cookie-based dashboard auth (from services)
  dashboard/
    unified.ts             — combined HTML (tabbed: Agents / Infrastructure / Credits)
    login.ts               — login page HTML
```

Key changes:
- **`config.ts`**: Merge pool env vars + services config into one. Single `POOL_API_KEY` for everything
- **`services/infra.ts` + `services/status.ts`**: Extract business logic OUT of Express route handlers into callable functions. Routes become thin wrappers
- **`pool.ts`**: Replace `servicesClient.createInstance()` → `import { createInstance } from "./services/infra.js"` (direct calls)
- **Delete** `services-client.ts` (no more HTTP calls)

## Phase 3: Unified dashboard

Single dashboard at `/` with session auth (cookie-based, `POOL_API_KEY` as password).

Three tabs matching pool dashboard design language:
- **Agents** — pool launch form + live agents feed (from pool dashboard)
- **Infrastructure** — master-detail instances view (from services dashboard)
- **Credits** — OpenRouter key usage grid (from services dashboard)

Top bar: pool status pills (idle/starting/claimed/crashed) + credits summary + logout button.

Routes:
```
Public:     GET /healthz, GET /version, GET /api/pool/counts
Session:    GET /admin (login), POST /admin/login, POST /admin/logout
            GET / (dashboard), GET /dashboard/*, DELETE /dashboard/kill/:id
Bearer:     All API routes (pool + services)
```

## Phase 4: Cleanup

- Delete `services/` directory entirely
- Update `pool/.env.example` with all env vars
- Update `pool/Dockerfile`
- Update `pool/README.md`
- Update root `package.json` (remove services scripts)
- Update `docs/schema.md`, `docs/testing.md`

## Env var changes

**Removed:** `SERVICES_URL`, `SERVICES_API_KEY`, `SERVICE_DATABASE_URL`
**Renamed:** `POOL_DATABASE_URL` → `DATABASE_URL` (with fallback)
**Added to pool:** `RAILWAY_API_TOKEN`, `RAILWAY_RUNTIME_IMAGE`, `OPENROUTER_MANAGEMENT_KEY`, `OPENROUTER_KEY_LIMIT`, `AGENTMAIL_API_KEY`, `AGENTMAIL_DOMAIN`, `TELNYX_API_KEY`, `TELNYX_MESSAGING_PROFILE_ID`, `OPENCLAW_PRIMARY_MODEL`, `XMTP_ENV`, `BANKR_API_KEY`, `TELNYX_PHONE_NUMBER`

## Railway deployment procedure

1. `POOL_MIN_IDLE=0` on pool (stop creating instances)
2. Copy `instances` table from pool DB → services DB
3. Set `DATABASE_URL` on pool to services DB URL
4. Add all services env vars to pool
5. Remove `SERVICES_URL`, `SERVICES_API_KEY`
6. Deploy merged code
7. Verify dashboard + tick loop
8. Remove services Railway service
9. Set `POOL_MIN_IDLE` back to desired count

## Verification

1. `pnpm build` — TypeScript compiles
2. `pnpm test` — status tests pass
3. `pnpm dev` — server starts, `GET /healthz` returns ok
4. `GET /admin` — login page renders
5. Login with `POOL_API_KEY` → redirects to `/` with tabbed dashboard
6. All 3 tabs render (Agents, Infrastructure, Credits)
7. `POST /api/pool/counts` returns counts
8. `pnpm db:migrate` creates all 3 tables
