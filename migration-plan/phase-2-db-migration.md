# Phase 2 — DB Migration (instances table)

[Back to plan](./plan.md) | [Architecture](./architecture.md) | Prev: [Phase 1 — GHCR](./phase-1-ghcr.md) | Next: [Phase 3 — Services](./phase-3-services.md)

---

## Goal

Replace the in-memory cache with a proper `instances` table in the pool DB. Everything else (Railway sharding, services extraction) stays untouched — this phase only changes where instance state lives.

## Work

### Pool DB
- Create `instances` table (replaces `agent_metadata`) with core columns:
  - `id`, `agent_name`, `status`, `url`, `deploy_status`, `conversation_id`, `invite_url`, `instructions`, `created_at`, `claimed_at`
- Dual-write to both cache and DB initially
- Switch reads from cache to DB
- Atomic claim via `FOR UPDATE SKIP LOCKED` (replaces in-memory claiming Set)
- Cache becomes thin hot-path optimization
- Ephemeral fields (`openRouterApiKey`, `privateWalletKey`, `gatewayToken`) stay in-memory only

### Batch status mapping

| Batch status | Pool `deploy_status` | Pool `status` transition |
|---|---|---|
| `deploying` | `deploying` | stays `starting` |
| `deploy_failed` | `deploy_failed` | → `stuck` |
| `healthy` | `healthy` | `starting` → `ready`, claimed stays `claimed` |
| `unreachable` | `unreachable` | → `stuck` (after `POOL_STUCK_TIMEOUT_MS`) |

## Validate

- Tick loop reads from DB, not just cache
- Claim is atomic (`FOR UPDATE SKIP LOCKED`)
- Cache stays in sync as a hot-path optimization
- Existing provisioning flow (single shared Railway project) still works unchanged

## Notes

- No Railway sharding here — that moves to Phase 4
- Template-related columns (`template_id`, `owner_id`) are NOT added here — they come in Phase 6
- Services DB tables (`instance_infra`, `instance_services`) and backfill are NOT part of this phase
