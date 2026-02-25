# Phase 2 — DB Migration (instances table)

[Back to plan](./plan.md) | [Architecture](./architecture.md) | Prev: [Phase 1 — GHCR](./phase-1-ghcr.md) | Next: [Phase 3 — Services](./phase-3-services.md)

## Status: Complete (PRs #116, #121, #125 → promoted via #127)

---

## Goal

Replace the in-memory cache with a proper `instances` table in the pool DB. Everything else (Railway sharding, services extraction) stays untouched — this phase only changes where instance state lives.

## What Shipped

### DB schema

`instances` table with columns: `id`, `service_id`, `name`, `url`, `status`, `deploy_status`, `agent_name`, `conversation_id`, `invite_url`, `instructions`, `created_at`, `claimed_at`, `source_branch`, `openrouter_key_hash`, `agentmail_inbox_id`, `gateway_token`, `runtime_image`.

Key indexes: `idx_instances_status`, `idx_instances_service_id`.

### Atomic claiming

`claimIdle()` uses `FOR UPDATE SKIP LOCKED` — picks the oldest idle instance, sets status to `claiming`, returns the row. On provision failure, `releaseClaim()` resets to `idle`. On success, `completeClaim()` fills metadata and sets `claimed`.

### DB-driven tick loop

Each tick:
1. Single batched `listProjectServices()` GQL query returns domains + deploy status + images for all services
2. Pool reconciles Railway state against DB rows
3. New services discovered on Railway → inserted as `starting`
4. Status transitions derived from deploy status + health check + age
5. Dead instances cleaned up

### Batched Railway API (PR #125)

The `listProjectServices()` query was extended to return `domains` and `source.image` inline, eliminating per-service `getServiceDomain()` and `getServiceImage()` calls.

| Area | Before | After |
|---|---|---|
| Tick loop | 1 + N calls/tick | 1 call/tick |

At 63 instances across 4 environments, this dropped Railway API usage from ~82% to ~5% of the 10K/hour limit. See [RAILWAY_RATE_LIMITS.md](../pool/RAILWAY_RATE_LIMITS.md).

### Migration path

Auto-migration on pool startup (`pool/src/db/migrate.js`):
1. Handles legacy `pool_instances` → `agent_metadata` rename
2. Creates `instances` table if missing
3. Backfills claimed `agent_metadata` rows into `instances`

Enrich script (`pool/src/db/enrich-instances.js`): backfills `instances` table from Railway API for unclaimed instances that only existed in cache.

### Dashboard fixes (PR #123)

- Fixed camelCase mapping for DB column names in API responses
- Fixed `isClaimed` check to use DB status
- Added Railway error logging

## Validate (all confirmed)

- Tick loop reads from DB, not just cache
- Claim is atomic (`FOR UPDATE SKIP LOCKED`)
- Cache stays in sync as a hot-path optimization
- Existing provisioning flow (single shared Railway project) works unchanged
- Batched Railway API: 1 call per tick regardless of instance count

## Notes

- No Railway sharding here — that moves to Phase 4
- `service_id` (Railway) lives on the `instances` table directly. When services extraction happens (Phase 3), Railway-specific columns will migrate to the services DB
- Template-related columns (`template_id`, `owner_id`) are NOT added here — they come in Phase 6
