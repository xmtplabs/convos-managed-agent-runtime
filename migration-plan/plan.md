# Convos Agents Migration Plan

**Date:** 2026-02-23
**Updated:** 2026-02-25
**Status:** In Progress (Phases 1–2 complete)

---

## Current State vs End State

Phases 1–2 are complete. The pool manager handles orchestration AND all external API calls (Railway, OpenRouter, AgentMail, etc.) with DB-backed instance state. The table below shows what exists today vs the end-state split.

| Concern | Today (pool monolith) | End state |
|---|---|---|
| Railway API calls | `pool/src/railway.js` (batched, 1 call/tick) | `services/src/infra/railway.ts` |
| GHCR image config | `RAILWAY_RUNTIME_IMAGE` env var on pool | `RAILWAY_RUNTIME_IMAGE` env var on services |
| OpenRouter key provisioning | `runtime/scripts/keys.sh` (self-provision) | `services/src/plugins/openrouter.ts` |
| AgentMail provisioning | `runtime/scripts/keys.sh` (self-provision) | `services/src/plugins/agentmail.ts` |
| Telnyx provisioning | `runtime/scripts/keys.sh` (self-provision) | `services/src/plugins/telnyx.ts` |
| Instance health checks | `pool/src/pool.js` (direct HTTP) | `services/status/batch` endpoint |
| Instance DB | `pool/src/db/` (`instances` table, atomic claim) | Split: pool DB (orchestration) + services DB (infra/resources) |
| Docker image build | CI → GHCR (done) | Same (no change) |
| Instance deployment | `serviceInstanceUpdate` with `source.image` | Same pattern, moved to services |

## Phases

| Phase | Name | Status | Details |
|-------|------|--------|---------|
| 1 | [GHCR CI Pipeline](./phase-1-ghcr.md) | **Complete** | Pre-built runtime images on GitHub Container Registry |
| 2 | [DB Migration](./phase-2-db-migration.md) | **Complete** | `instances` table, atomic claim, batched Railway API |
| 3 | [Extract Services](./phase-3-services.md) | Planned | Services deployable, pool calls services via HTTP, shared project |
| 4 | [Railway Sharding](./phase-4-sharding.md) | Planned | One-project-per-agent, backfill migration |
| 5 | [Dashboard (React + Vite + TypeScript)](./phase-5-dashboard.md) | Planned | Product UI built against pool APIs, TypeScript codebase |
| 6 | [Templates](./phase-6-templates.md) | Planned | `agent_templates` table, template-aware claiming |

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

