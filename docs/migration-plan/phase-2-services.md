# Phase 2 — Extract Services + Infra Lifecycle (includes sharding)

[Back to plan](./plan.md) | [Architecture](./architecture.md) | Prev: [Phase 1 — DB Migration](./phase-1-db-migration.md) | Next: [Phase 3 — Dashboard](./phase-3-dashboard.md)

---

## Goal

Extract all external API integrations into a standalone `services` deployable. Implement one-project-per-agent sharding as part of this extraction so that provisioning only migrates once.

## Work

### Services package
- Create `services/` at root with its own `package.json`, `tsconfig.json`, `Dockerfile`
- Services is an Express server exposing an internal HTTP API
- Move service registry + plugin logic from `pool/src/services.js` → `services/src/plugins/`
- Move Railway logic → `services/src/infra/railway.ts`

### Infra lifecycle routes
- `POST /create-instance` — create Railway project + deploy GHCR image + provision OpenRouter + wallet
- `DELETE /destroy/:instanceId` — cleanup external resources + `projectDelete`
- `POST /status/batch` — batch health + deploy status check
- `POST /redeploy/:instanceId` — trigger redeployment (new image pull)

### Tool provisioning routes
- `POST /provision/:instanceId/:toolId` — provision a specific tool for an instance
- `DELETE /destroy/:instanceId/:toolId/:resourceId` — destroy a specific provisioned resource
- `POST /configure/:instanceId` — push instructions, name, model to running instance
- `GET /registry` — list available tools and their provisioning modes

### Infrastructure
- `create-instance` handles: `projectCreate` → environment setup → GHCR credentials → `serviceCreate` from image → env vars → volume → OpenRouter + wallet provisioning
- `destroy/:instanceId` handles: external resource cleanup → `projectDelete`
- Services DB: `instance_infra` + `instance_services` tables
- Pool calls services via `SERVICES_URL` (Railway private networking) — no workspace import
- Auth between pool↔services via `SERVICES_API_KEY`
- Auth for runtime→services via `INSTANCE_SERVICES_TOKEN` (per-instance, generated at creation time)

### Pool changes
- Replace direct Railway/OpenRouter/AgentMail/Telnyx/Bankr calls with HTTP calls to services
- Pool becomes provider-agnostic — only knows instance IDs and service URLs

## Validate

- Pool can create instances via services (new Railway projects with GHCR images)
- Pool can destroy instances via services (external cleanup + project deletion)
- Tick loop works with batch status endpoint
- Claiming works with tool provisioning via services
- Runtime can self-provision via `INSTANCE_SERVICES_TOKEN`
- **One-project-per-agent is live after this phase**

## Notes

- **Railway API token must be team/org-scoped** (not project-scoped) to create new projects — verify token scope during implementation
- Concurrency limit: ~8 parallel agent creations to stay within Railway's 50 RPS rate limit (Pro plan). Each agent creation takes ~5-6 sequential API calls
- Existing agents in the old single project continue working during transition
- New agents get their own projects with pre-built images
