# Convos Agents Scaling Plan

**Date:** 2026-02-23
**Status:** In Progress

This plan covers multi-project sharding (one Railway project per agent + GHCR), portable agent instances (templates + cloning), and a product dashboard.

**Target architecture:** [architecture.md](./architecture.md)

---

## Phases

| Phase | Name | Status | Details |
|-------|------|--------|---------|
| 0 | [GHCR CI Pipeline](./phase-0-ghcr.md) | **Complete** | Pre-built runtime images on GitHub Container Registry |
| 1 | [Extract Services + Sharding](./phase-3-services.md) | Planned | Services deployable, one-project-per-agent |
| 2 | [DB Migration (instances + services)](./phase-4-db-migration.md) | Planned | Pool `instances` table, atomic claim, validate end-to-end |
| 3 | [Template DB, CRUD + Claim](./phase-5-templates.md) | Planned | `agent_templates` table, template-aware claiming |
| 4 | [Dashboard (React + Vite)](./phase-6-dashboard.md) | Planned | Real product UI built against template APIs |

### Nice-to-haves (not blocking)

| Item | Details |
|------|---------|
| [Monorepo Foundation](./phase-1-monorepo.md) | pnpm workspace, turbo, runtime extraction |
| [TypeScript Migration (pool)](./phase-2-typescript.md) | Convert pool from JS to TS |

---

## Key Decisions

1. **Railway project lifecycle — services owns it.** Pool never knows Railway project IDs exist.
2. **Unified instance schema — split by domain.** Pool DB stores orchestration state. Services DB stores Railway and external resource state.
3. **`railway_project_id` — services DB only.** Pool identifies instances by `instance_id`.
4. **Tick loop — batch status endpoint.** `POST services/status/batch` returns a status map. One HTTP call per tick.
5. **GHCR CI — auto on push, branch-name + SHA tags.** Staging-to-production promotion via branch tagging.
6. **Phase sequencing — GHCR first, validate infra before templates, dashboard last.** Phase 0 ships GHCR (standalone). Phase 1 extracts services with sharding so provisioning migrates once. Phase 2 lands the DB migration to validate against real data. Phase 3 adds templates. Dashboard (Phase 4) comes last, built against the real APIs.
7. **Teardown — external cleanup then project delete.** OpenRouter → AgentMail → Telnyx → Bankr → `projectDelete`.
8. **Template-aware provisioning — claim-time resolution.** Idle instances are generic. Templates apply at claim time.
9. **Services API surface — infra and tools are separate route groups.** `/create-instance` vs `/provision/:instanceId/:toolId`.
10. **Pre-warming stays.** GHCR makes idle instance creation cheap (~under 1 min). `POOL_MIN_IDLE` controls warm pool size.
11. **URL source of truth — services.** Pool stores a copy for client-facing APIs.
