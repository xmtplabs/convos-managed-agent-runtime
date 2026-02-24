

## Current State vs End State

Phase 0 is complete. The pool manager currently does everything (orchestration + Railway API + external APIs). The table below shows what exists today vs the end-state split.

| Concern | Today (pool monolith) | End state |
|---|---|---|
| Railway API calls | `pool/src/railway.js` | `services/src/infra/railway.ts` |
| GHCR image config | `RAILWAY_RUNTIME_IMAGE` env var on pool | `RAILWAY_RUNTIME_IMAGE` env var on services |
| OpenRouter key provisioning | `runtime/scripts/keys.sh` (self-provision) | `services/src/plugins/openrouter.ts` |
| AgentMail provisioning | `runtime/scripts/keys.sh` (self-provision) | `services/src/plugins/agentmail.ts` |
| Telnyx provisioning | `runtime/scripts/keys.sh` (self-provision) | `services/src/plugins/telnyx.ts` |
| Instance health checks | `pool/src/pool.js` (direct HTTP) | `services/status/batch` endpoint |
| Instance DB | `pool/src/db/` (single table) | Split: pool DB (orchestration) + services DB (infra/resources) |
| Docker image build | CI → GHCR (done) | Same (no change) |
| Instance deployment | `serviceInstanceUpdate` with `source.image` | Same pattern, moved to services |

## Phases

| Phase | Name | Status | Details |
|-------|------|--------|---------|
| 1 | [GHCR CI Pipeline](./phase-1-ghcr.md) | **Complete** | Pre-built runtime images on GitHub Container Registry |
| 2 | [DB Migration](./phase-2-db-migration.md) | Planned | Pool `instances` table, atomic claim, replace in-memory cache |
| 3 | [Extract Services](./phase-3-services.md) | Planned | Services deployable, pool calls services via HTTP, shared project |
| 4 | [Railway Sharding](./phase-4-sharding.md) | Planned | One-project-per-agent, backfill migration |
| 5 | [Dashboard (React + Vite + TypeScript)](./phase-5-dashboard.md) | Planned | Product UI built against pool APIs, TypeScript codebase |
| 6 | [Templates](./phase-6-templates.md) | Planned | `agent_templates` table, template-aware claiming |

