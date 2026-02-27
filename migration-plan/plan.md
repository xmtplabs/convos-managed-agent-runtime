# Convos Agents Migration Plan

**Date:** 2026-02-23
**Updated:** 2026-02-25
**Status:** In Progress (Phases 1–2 complete)

---

## Current State

Phases 1–3, 5, and 6 are complete. The pool manager is TypeScript + Drizzle ORM with a normalized DB schema (`instances`, `instance_infra`, `instance_services`, `agent_templates`). Services (Railway, OpenRouter, AgentMail, Telnyx, wallet) live in `pool/src/services/`. Dashboard is a Next.js app at `dashboard/`. Template system (CRUD + template-aware claim) is in place. **Remaining work:** Phase 4 — Railway sharding.

## Phases

- [x] 1 — [GHCR CI Pipeline](./phase-1-ghcr.md)
- [x] 2 — [DB Migration](./phase-2-db-migration.md)
- [x] 3 — [Extract Services](./phase-3-services.md)
- [ ] 4 — [Railway Sharding](./phase-4-sharding.md) _(remaining)_
- [x] 5 — [Dashboard](./phase-5-dashboard.md)
- [x] 6 — [Templates](./phase-6-templates.md)

| Phase | Name | Status | Details |
|-------|------|--------|---------|
| 1 | [GHCR CI Pipeline](./phase-1-ghcr.md) | **Complete** | Pre-built runtime images on GitHub Container Registry |
| 2 | [DB Migration](./phase-2-db-migration.md) | **Complete** | Pool `instances` table with Drizzle ORM, atomic claim, DB-driven tick loop |
| 3 | [Extract Services](./phase-3-services.md) | **Complete** | Service providers in `pool/src/services/`, normalized schema, TypeScript migration |
| 4 | [Railway Sharding](./phase-4-sharding.md) | **Planned** | One-project-per-agent, backfill migration |
| 5 | [Dashboard](./phase-5-dashboard.md) | **Complete** | Next.js app at `dashboard/`, consumes pool API |
| 6 | [Templates](./phase-6-templates.md) | **Complete** | `agent_templates` table, CRUD routes, template-aware claim |

## What Shipped

### Phase 1 — GHCR CI Pipeline
- Pre-built runtime images on GitHub Container Registry
- Single `:latest` tag, QA-gated publish workflow

### Phase 2 — DB Migration
- `instances` table replaces in-memory cache (Drizzle ORM)
- Atomic claim via `FOR UPDATE SKIP LOCKED`
- DB-driven tick loop with explicit cleanup
- Batched `listProjectServices()` Railway API calls
- Startup auto-migrations (idempotent, safe to re-run)

### Phase 3 — Services + TypeScript
- Full TypeScript migration of pool (`*.js` → `*.ts`) with Drizzle ORM
- Normalized DB: `instance_infra` (Railway/infra details) + `instance_services` (provisioned resources)
- Service provider modules: `pool/src/services/providers/` (railway, openrouter, agentmail, telnyx, wallet, env)
- Service routes: `pool/src/services/routes/` (infra, status, configure, tools, dashboard, registry)
- Imperative migration with backfill from old flat schema to new normalized schema
- Services integrated directly in pool (no separate HTTP deployable — simpler than planned)

### Phase 5 — Dashboard
- Next.js app at `dashboard/` (server-side rendering, admin UI)
- Consumes pool API (counts, agent list, claim, templates)

### Phase 6 — Templates
- `agent_templates` table and CRUD endpoints
- Template-aware claim flow (`templateId` on `POST /api/pool/claim`)

### Deviations from Original Plan
- **Services are local, not a separate deployable** — the HTTP boundary added complexity without benefit at current scale. Providers live in `pool/src/services/` and are called directly.
- **Single DB, not split** — `instance_infra` and `instance_services` tables live in the pool DB alongside `instances`. Simpler to operate.
- **Dashboard is Next.js, not Vite+React SPA** — shipped as `dashboard/` with server-side rendering and admin UI.

---

## What Shipped

### Phase 1 — GHCR CI Pipeline (PR [#98](https://github.com/xmtplabs/convos-agents/pull/98))

See [phase-1-ghcr.md](./phase-1-ghcr.md) for full details.

### Phase 2 — DB Migration (PRs [#116](https://github.com/xmtplabs/convos-agents/pull/116), [#121](https://github.com/xmtplabs/convos-agents/pull/121), [#123](https://github.com/xmtplabs/convos-agents/pull/123), [#125](https://github.com/xmtplabs/convos-agents/pull/125))

Promoted to main via PR [#127](https://github.com/xmtplabs/convos-agents/pull/127).

- **`instances` table** replaces in-memory cache — full instance lifecycle tracked in Postgres
- **Atomic claiming** via `FOR UPDATE SKIP LOCKED` (no more in-memory claiming Set)
- **DB-driven tick loop** — reconciles Railway state against DB rows each tick
- **Batched Railway API** — single `listProjectServices()` GQL query returns domains + images + deploy status for all services in one call. Tick cost is now O(1) not O(N). See [RAILWAY_RATE_LIMITS.md](../pool/RAILWAY_RATE_LIMITS.md)
- **`runtime_image` column** — tracks which GHCR image each instance is running
- **Enrich script** (`pool/src/db/enrich-instances.js`) — backfills `instances` table from Railway API
- **Dashboard fixes** — camelCase mapping, `isClaimed` check, Railway error logging

#### Schema: `instances` table (as shipped)

```sql
CREATE TABLE instances (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  url TEXT,
  status TEXT NOT NULL DEFAULT 'starting',
  deploy_status TEXT,
  agent_name TEXT,
  conversation_id TEXT,
  invite_url TEXT,
  instructions TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  source_branch TEXT,
  openrouter_key_hash TEXT,
  agentmail_inbox_id TEXT,
  gateway_token TEXT,
  runtime_image TEXT
);
```

Statuses: `starting` → `idle` → `claiming` → `claimed`, or `dead`/`crashed`/`sleeping`

#### Deviations from original plan

1. **Shipped before services extraction.** Plan had DB migration as Phase 4, after services extraction. In practice, DB-backed state was needed immediately for production stability, so it shipped as Phase 2.
2. **Railway API batching included.** Not in original plan, but at 63 instances across 4 environments, per-service API calls consumed 82% of Railway's 10K/hour rate limit. Batching was critical.
3. **Schema differs from planned.** `service_id` (Railway) is on the `instances` table directly (not in a separate services DB). This will change when services extraction happens in Phase 3.
4. **In-memory cache kept as hot-path.** `pool/src/cache.js` still runs alongside DB for fast reads. DB is source of truth.

