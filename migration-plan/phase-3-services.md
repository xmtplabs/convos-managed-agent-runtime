# Phase 3 — Extract Services

[Back to plan](./plan.md) | [Architecture](./architecture.md) | Prev: [Phase 2 — DB Migration](./phase-2-db-migration.md) | Next: [Phase 4 — Railway Sharding](./phase-4-sharding.md)

---

## Goal

Extract all external API integrations into a standalone `services` deployable. Still deploys into the single shared Railway project (same as today) — sharding comes next phase.

## Work

### Services package
- Create `services/` at root with its own `package.json`, `tsconfig.json`, `Dockerfile`
- Services is an Express server exposing an internal HTTP API
- Move service registry + plugin logic from `pool/src/services.js` → `services/src/plugins/`
- Move Railway logic → `services/src/infra/railway.ts`

### Infra lifecycle routes
- `POST /create-instance` — deploy GHCR image into shared project + provision OpenRouter + wallet
- `DELETE /destroy/:instanceId` — cleanup external resources + `serviceDelete`
- `POST /status/batch` — batch health + deploy status check
- `POST /redeploy/:instanceId` — trigger redeployment (new image pull)

### Tool provisioning routes
- `POST /provision/:instanceId/:toolId` — provision a specific tool for an instance
- `DELETE /destroy/:instanceId/:toolId/:resourceId` — destroy a specific provisioned resource
- `POST /configure/:instanceId` — push instructions, name, model to running instance
- `GET /registry` — list available tools and their provisioning modes

### Infrastructure
- `create-instance` handles: `serviceCreate` from GHCR image in shared project → env vars → volume → OpenRouter + wallet provisioning
- `destroy/:instanceId` handles: external resource cleanup → `serviceDelete`
- Services DB: `instance_infra` + `instance_services` tables
- Pool calls services via `SERVICES_URL` (Railway private networking) — no workspace import
- Auth between pool↔services via `SERVICES_API_KEY`
- Auth for runtime→services via `INSTANCE_SERVICES_TOKEN` (per-instance, generated at creation time)

### Pool changes
- Replace direct Railway/OpenRouter/AgentMail/Telnyx/Bankr calls with HTTP calls to services
- Pool becomes provider-agnostic — only knows instance IDs and service URLs

## Validate

- Pool can create instances via services (GHCR images in shared project)
- Pool can destroy instances via services (external cleanup + service deletion)
- Tick loop works with batch status endpoint
- Claiming works with tool provisioning via services
- Runtime can self-provision via `INSTANCE_SERVICES_TOKEN`

## Notes

- Deployment topology doesn't change here — still one shared Railway project, same as today
- This phase validates the services extraction in isolation before changing Railway topology
- Existing agents continue working unchanged during rollout
