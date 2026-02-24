# Phase 1 — DB Migration (instances + services infra)

[Back to plan](./plan.md) | [Architecture](./architecture.md) | Prev: [Phase 0 — GHCR](./phase-0-ghcr.md) | Next: [Phase 2 — Services](./phase-2-services.md)

---

## Goal

Replace the in-memory cache with a proper `instances` table in pool DB. Validate that the new provisioning + sharding pipeline works end-to-end against real data.

## Work

### Pool DB
- Create `instances` table (replaces `agent_metadata`) with core columns:
  - `id`, `agent_name`, `status`, `url`, `deploy_status`, `conversation_id`, `invite_url`, `instructions`, `created_at`, `claimed_at`
- Dual-write to both cache and DB initially
- Switch reads from cache to DB
- Atomic claim via `FOR UPDATE SKIP LOCKED` (replaces in-memory claiming Set)
- Cache becomes thin hot-path optimization
- Ephemeral fields (`openRouterApiKey`, `privateWalletKey`, `gatewayToken`) stay in-memory only

### Services DB
- `instance_infra` and `instance_services` tables already exist from Phase 2
- Migration backfills existing rows: set `railway_project_id` on `instance_infra` from the current shared project ID

### Batch status mapping

| Batch status | Pool `deploy_status` | Pool `status` transition |
|---|---|---|
| `deploying` | `deploying` | stays `starting` |
| `deploy_failed` | `deploy_failed` | → `stuck` |
| `healthy` | `healthy` | `starting` → `ready`, claimed stays `claimed` |
| `unreachable` | `unreachable` | → `stuck` (after `POOL_STUCK_TIMEOUT_MS`) |

## Validate

- New provisioning + sharding works end-to-end against real DB
- Tick loop reads from DB, not just cache
- Claim is atomic (`FOR UPDATE SKIP LOCKED`)
- Backfill migration runs cleanly on existing data
- Cache stays in sync as a hot-path optimization

## Notes

- Template-related columns (`template_id`, `owner_id`) are NOT added here — they come in Phase 4
- This keeps the migration focused on validating the core infra pipeline
