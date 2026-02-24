# Convos Agents Monorepo

**Date:** 2026-02-23
**Status:** Draft

This plan merges the monorepo restructuring, multi-project sharding (one Railway project per agent + GHCR), and portable agent instances (templates + cloning) into a single execution path.

**Target architecture:** [architecture.md](./architecture.md)

---

## Phases

| Phase | Name | Details |
|-------|------|---------|
| 0 | [GHCR CI Pipeline](./phase-0-ghcr.md) | Pre-built runtime images on GitHub Container Registry |
| 1 | [Monorepo Foundation](./phase-1-monorepo.md) | pnpm workspace, turbo, runtime extraction |
| 2 | [TypeScript Migration (pool)](./phase-2-typescript.md) | Convert pool from JS to TS |
| 3 | [Extract Services + Sharding](./phase-3-services.md) | Services deployable, one-project-per-agent |
| 4 | [DB Migration (instances + services)](./phase-4-db-migration.md) | Pool `instances` table, atomic claim, validate end-to-end |
| 5 | [Template DB, CRUD + Claim](./phase-5-templates.md) | `agent_templates` table, template-aware claiming |
| 6 | [Dashboard (React + Vite)](./phase-6-dashboard.md) | Real product UI built against template APIs |

---

## Key Decisions

1. **Railway project lifecycle — services owns it.** Pool never knows Railway project IDs exist.
2. **Unified instance schema — split by domain.** Pool DB stores orchestration state. Services DB stores Railway and external resource state.
3. **`railway_project_id` — services DB only.** Pool identifies instances by `instance_id`.
4. **Tick loop — batch status endpoint.** `POST services/status/batch` returns a status map. One HTTP call per tick.
5. **GHCR CI — auto on push, branch-name + SHA tags.** Staging-to-production promotion via branch tagging.
6. **Phase sequencing — GHCR first, validate infra before templates, dashboard last.** Phase 0 ships GHCR (standalone). Phase 3 extracts services with sharding so provisioning migrates once. Phase 4 lands the DB migration to validate against real data. Phase 5 adds templates. Dashboard (Phase 6) comes last, built against the real APIs. Template sync + clone is a separate follow-up project.
7. **Teardown — external cleanup then project delete.** OpenRouter → AgentMail → Telnyx → Bankr → `projectDelete`.
8. **Template-aware provisioning — claim-time resolution.** Idle instances are generic. Templates apply at claim time.
9. **Services API surface — infra and tools are separate route groups.** `/create-instance` vs `/provision/:instanceId/:toolId`.
10. **Pre-warming stays.** GHCR makes idle instance creation cheap (~20-30s). `POOL_MIN_IDLE` controls warm pool size.
11. **URL source of truth — services.** Pool stores a copy for client-facing APIs.

---

## Future: Template Sync + Clone

Out of scope for the phases above. Next project after Phase 6.

- Pool DB: add `parent_instance`, `template_synced_at` columns to `instances`

**Sync:** When `PUT /api/pool/templates/:id` updates a template:
1. Update `agent_templates` row
2. Query instances with `template_id = :id`
3. Fan out `POST instance.url/pool/update-template`
4. Set `instances.template_synced_at = NOW()` on success

**Clone:** Extended `POST /api/pool/claim` when `cloneFrom` present:
1. Verify `requester == parent's owner_id`
2. Provision child with template + fresh services-managed tools
3. Write `parent_instance = cloneFrom` on child
4. After child is live: `POST parent.url/pool/clone-summary`
5. Return claim result immediately (context transfer is async)
