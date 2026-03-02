# Pool Manager Changelog

## 0.5.0
- Runtime version: dashboard now shows each instance's runtime version, captured during health checks
- Provision cards: inline Railway deeplinks per step (project, service, domain, deploy) with grid layout
- Volume persistence: volume attached before first deploy so agent state survives restarts
- State directory: `OPENCLAW_STATE_DIR` derived from volume mount automatically — no more hardcoded `/app`
- Recheck fix: crashed instances no longer falsely promoted to idle
- Drain UX: drain cards now show instance name instead of number
- Image picker: removed stale `:latest` tag, defaults to `:production`

## 0.4.0
- On-demand reconciliation: replaced the 30s tick loop with manual reconcile at three granularity levels — eliminates overlapping ticks and false deaths from Railway sleep timeouts
- Rate limit batching: status calls batched per project (1 call per project instead of ~100 individual calls per tick)
- Recheck button: added to all instance rows (was only on crashed), with bulk recheck on Crashed stat card
- Sortable columns: Usage and Uptime headers now clickable to sort asc/desc
- Runtime update: per-instance button to redeploy with a new image
- Deploy status: skip DB update when Railway returns unknown status, preserving last known state

## 0.3.0
- Railway sharding: each new agent gets its own Railway project for scalability and network isolation
- Security patch: removed `POOL_API_KEY` from admin HTML, added session cookie auth, protected dashboard routes with `requireAuth`, restricted `/dashboard/instances` to exclude secrets
- Parallel provisioning: worker-pool pattern (max 5 concurrent) for both SSE and POST replenish endpoints — 10 instances in ~1 min instead of ~5-10 min
- Real-time provision logs: SSE stream endpoint (`/api/pool/claim/stream`) shows step-by-step progress in the dashboard
- Telnyx fix: moved phone provisioning before OpenRouter/AgentMail, random pick from 20 numbers to reduce collisions, re-search on 409/422
- Datadog metrics: batch status, health, and tick metrics in one summary line
- Already-joined fix: handle "Already joined this conversation" with pending conversation ID without triggering 30 retries

## 0.2.0
- Admin page: replaced inline dashboard with password-protected `/admin` page behind session auth
- Instance visibility: admin table now shows all statuses (Ready, Starting, Running, Crashed) with color-coded badges
- Per-instance drain: drain button on idle and starting rows, matching Kill for running agents
- Self-destruct: three-layer chain so agents can request their own termination and release all resources (Railway service, volumes, API keys, AgentMail inbox, DB row)
- Claim API: `agentName` and `instructions` now optional in `/api/pool/claim`
- Migration: relaxed NOT NULL on legacy columns for backwards-compatible schema migration
- Idle health check: proper cycle for verifying starting → idle transitions

## 0.1.0
- GHCR image pool: runtime images built and published to GitHub Container Registry, deployed to Railway on provision
- Dashboard: dual-mode UI — end-user mode (spacious launch form) and dev mode (pool controls + live instance table)
- DB-backed instances: replaced in-memory Map with `instances` table — persists state across restarts, atomic claiming via `FOR UPDATE SKIP LOCKED`
- Railway API batching: domains and images batched into single `listProjectServices()` call per tick (was 1+N calls, ~193K/day across 4 envs)
- Runtime image tags: auto-derived from branch name, removing manual `RAILWAY_RUNTIME_IMAGE` config

---

> **Style guide:** Pool manager infrastructure, dashboard, and API changes. Each entry should name the feature, then briefly explain what changed and why. Keep technical detail but add plain-language context.
