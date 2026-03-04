# Pool Manager Changelog

## 0.9.0
- Stripe integration: PaymentIntent flow with webhook processing — payments increase OpenRouter credit limit
- Coupon codes: `COUPON_CODE` env var, redeems for $20 credit bump
- Removed $100 credit cap on admin top-ups
- New env vars: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `COUPON_CODE`

## 0.8.0
- Drizzle Kit migrations: replaced hand-written idempotent SQL in `migrate.ts` with Drizzle Kit's migration system — `schema.ts` is now the single source of truth for both queries and migrations, eliminating schema drift between the two files
- New workflow: edit `schema.ts` → run `pnpm db:generate` → commit the migration file → deploy
- Baseline seeding: `seedBaseline()` handles existing databases by detecting tables without `__drizzle_migrations` tracking, backfilling any missing columns, and inserting the baseline record so the initial migration is skipped

## 0.7.0
- Railway webhooks: push-based state monitoring via Railway workspace-level webhooks — instances automatically transition on deploy/crash/sleep events without manual "Check Starting" clicks
- Webhook state machine: pure `decideAction()` function handles all Railway event types (`deployed`, `crashed`, `failed`, `oom_killed`, `slept`, `resumed`) with claiming guard and conditional updates to prevent race conditions
- Health check retries: deployed/resumed events trigger up to 5 health checks (3s apart) before promoting `starting → idle` or recovering `crashed → claimed`
- Auto-registration: pool manager registers webhook rules with Railway on startup (graceful no-op if env vars missing)
- Webhook auth: secret-in-URL-path pattern (`/webhooks/railway/{POOL_API_KEY}`) since Railway doesn't support HMAC signing
- Datadog metrics: `webhook.received`, `webhook.processed`, `webhook.error`, `webhook.state_change`, `webhook.health_check_promoted`
- No auto-cleanup: crash/failure events only mark status in DB — dead instances must still be cleaned up manually via the dashboard

## 0.6.0
- Credits self-service: new `POST /api/pool/credits-check` and `POST /api/pool/credits-topup` endpoints — instances can check their own OpenRouter spending balance and request limit increases using gatewayToken auth (same pattern as self-destruct)
- Top-up cap: self-service top-ups capped at $100 (configurable via `OPENROUTER_TOPUP_MAX` env), with $20 increments (`OPENROUTER_TOPUP_INCREMENT`)

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
