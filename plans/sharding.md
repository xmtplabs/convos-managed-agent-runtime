**Date:** 2026-02-23
**Status:** Draft
**Branch base:** `chore/browser-openclaw-skill` (merge first)

## Problem

Three architectural issues limit the agent fleet:

1. **100-service limit.** Railway caps services per project at 100. Target fleet is 500+.
2. **No network isolation.** All agents in a project share a private network (`.railway.internal`). A compromised agent can discover and reach others.
3. **Slow builds.** Each agent service builds from Dockerfile (Chromium, Node deps, OpenClaw) taking 5-10 minutes. Pool replenishment is bottlenecked.

## Solution

One Railway project per agent, deployed from a pre-built Docker image hosted on GitHub Container Registry (GHCR).

## Architecture

```
GitHub Actions (CI)
  ├── On push to staging: build + push ghcr.io/xmtplabs/convos-agent:staging
  └── On push to main:    build + push ghcr.io/xmtplabs/convos-agent:production

Pool Manager (single project with Postgres)
  ├── Claim request arrives
  ├── Pick idle agent from cache
  ├── POST /pool/provision to agent
  └── Return invite URL + gateway token

Agent Creation (per agent)
  ├── projectCreate → new Railway project
  ├── Create environment matching pool manager's RAILWAY_ENVIRONMENT_NAME
  ├── Configure GHCR registry credentials on project
  ├── serviceCreate → deploy from ghcr.io/xmtplabs/convos-agent:<tag>
  ├── Set env vars, resource limits, create /data volume
  └── Insert into agent_metadata with railway_project_id

Agent Teardown
  ├── destroyAll() → clean up OpenRouter key, AgentMail inbox, etc.
  └── projectDelete → removes service, volumes, everything
```

## 1. CI Pipeline

GitHub Actions workflow triggered on push to `staging` and `main`.

**Steps:**

1. Build the agent `Dockerfile` (the existing one with Chromium, Node 22, pnpm, OpenClaw workspace)
2. Tag the image:
    - `ghcr.io/xmtplabs/convos-agent:staging` or `:production` (branch-based)
    - `ghcr.io/xmtplabs/convos-agent:sha-<commit>` (for rollback/pinning)
3. Push to GHCR (authenticated via `GITHUB_TOKEN`)

The pool manager Dockerfile (`pool/Dockerfile`) is NOT part of this pipeline. It stays deployed on Railway from source. Only the agent image gets pre-built.

## 2. One Project Per Agent

Each agent instance gets its own Railway project. No shared private network, ever.

### Agent Creation Flow

1. `projectCreate` mutation — new Railway project
2. Create environment matching `RAILWAY_ENVIRONMENT_NAME` (staging or production)
3. Configure GHCR registry credentials on the new project
4. `serviceCreate` — deploy from pre-built GHCR image (no git source, no build step)
5. Set env vars, resource limits, create persistent `/data` volume
6. Insert into `agent_metadata` with `railway_project_id`

### Agent Teardown Flow

1. `destroyAll()` from `services.js` — clean up external resources (OpenRouter key, AgentMail inbox)
2. `projectDelete` — deletes the entire Railway project (service, volumes, everything)
3. Remove from DB and cache

This is simpler than current teardown which individually cleans up volumes. Deleting the project handles it.

### Database Changes

**`agent_metadata` table:**

- Add: `railway_project_id TEXT NOT NULL` — the Railway project this agent lives in
- Drop: `source_branch TEXT` — no longer relevant, image tag determines version

Migration backfills existing rows with the pool manager's current `RAILWAY_PROJECT_ID` for backward compatibility during transition.

## 3. Pre-built Image Deployment

### What Changes in `railway.js`

**Removed:**

- `serviceConnect` / `serviceDisconnect` calls (git repo connection)
- All repo/branch configuration logic

**Changed:**

- `createService()` accepts `projectId` and `environmentId` as parameters instead of reading from env vars
- Service is created with an `image` source pointing to GHCR instead of git source

**`RAILWAY_PROJECT_ID` clarification:** After this change, the pool manager's own `RAILWAY_PROJECT_ID` (auto-set by Railway) refers to the pool manager's project only. Agent project IDs are per-agent, stored in `agent_metadata.railway_project_id`.

### Image Tag Selection

Pool manager's `RAILWAY_ENVIRONMENT_NAME` determines the tag:

- `staging` → `ghcr.io/xmtplabs/convos-agent:staging`
- `production` → `ghcr.io/xmtplabs/convos-agent:production`

Optional override via `AGENT_IMAGE_TAG` env var to pin to a specific SHA.

### Updating Running Agents

New image pushes do NOT auto-update existing agents. New agents get the latest image. For existing agents:

- **Default:** Old agents keep running their current image, naturally cycle out on teardown
- **Manual:** Pool API endpoint `POST /api/pool/redeploy` triggers `deploymentRedeploy` on idle agents
- **Future:** Gradual drain-and-replace rollout (not in initial scope)

## 4. Fleet Management

### Replenishment

Core logic unchanged: maintain `POOL_MIN_IDLE` idle instances. Creating an idle agent now means more API calls (project + environment + credentials + service) but each completes in seconds since there's no build.

Concurrency limit: ~8 parallel agent creations to stay within Railway's 50 RPS rate limit (Pro plan). Each agent creation takes ~5-6 sequential API calls.

### Health Checks

No change. Health checks already go over the public internet via each agent's `https://{domain}.up.railway.app/pool/health` endpoint with bearer token auth.

### Tick Loop

The tick no longer queries a single project for all services. Instead:

1. Load all non-deleted agents from `agent_metadata` (DB is source of truth)
2. For each agent, query its Railway service deployment status in parallel (batched at ~40 concurrent to respect rate limits)
3. Health-check all agents with SUCCESS deploy status in parallel (not Railway API calls, no rate limit)
4. Derive status, update cache, replenish/cleanup as needed

At 500+ agents, tick will take longer. Consider increasing tick interval from 30s to 60s.

### Rolling Updates

Start with "do nothing" + manual redeploy for idle agents. Gradual rollout is future work.

## 5. Secrets and Configuration

### GHCR Credentials

Each new Railway project needs GHCR credentials so it can pull the private image. Configured once per project via Railway API at creation time.

- **Registry:** `ghcr.io`
- **Username:** `xmtplabs` (or dedicated bot account)
- **Password:** GitHub PAT with `read:packages` scope

### New Pool Manager Env Vars

```
GHCR_TOKEN        — GitHub PAT with read:packages scope (for configuring new projects)
AGENT_IMAGE       — e.g. ghcr.io/xmtplabs/convos-agent
AGENT_IMAGE_TAG   — optional override, defaults based on RAILWAY_ENVIRONMENT_NAME
```

### Env Vars No Longer Needed

```
RAILWAY_SOURCE_REPO           — already removed in chore/browser-openclaw-skill
RAILWAY_SOURCE_BRANCH         — already removed in chore/browser-openclaw-skill
```

`RAILWAY_GIT_*` vars are auto-set by Railway for the pool manager's own deployment but are not used for agent creation.

### Railway API Token Scope

The current `RAILWAY_API_TOKEN` may be project-scoped. This design requires a team-level or org-level token with permission to create new projects. Verify token scope during implementation.

## 6. Migration Path

1. Merge `chore/browser-openclaw-skill` branch
2. Ship CI pipeline (GitHub Actions workflow for GHCR builds)
3. Update pool manager: new `railway.js` (project creation, image-based deployment), DB migration, tick changes
4. Deploy updated pool manager
5. Existing agents in the old single project continue working (backfilled `railway_project_id`)
6. New agents get their own projects with pre-built images
7. Once all old agents are cycled out, delete the old shared project

## Key Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Agents per project | 1 | Maximum network isolation |
| Container registry | GHCR | Already using GitHub, free for org |
| Image tag strategy | Branch name + SHA | Simple, supports rollback |
| Tick data source | DB-driven | Can't query one project anymore |
| Agent updates | Manual redeploy | Safe default, gradual rollout later |
| Project cleanup | Delete entire project | Simpler than individual resource cleanup |