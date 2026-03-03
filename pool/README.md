# Pool

Manages pre-warmed [OpenClaw](https://github.com/xmtplabs/openclaw) agent instances on [Railway](https://railway.com). Instances are created ahead of time so claiming one takes seconds, not minutes.

Pool is a unified service — instance lifecycle management and all provider interactions (Railway, OpenRouter, AgentMail, Telnyx) run in a single process with a single Postgres database.

## How it works

```
                         ┌──────────────┐
                         │  Pool Manager │
                         │  (this repo)  │
                         └──┬───┬───┬───┘
               creates      │   │   │      polls /pool/health
            ┌───────────────┘   │   └───────────────┐
            ▼                   ▼                    ▼
    ┌──────────────┐   ┌──────────────┐     ┌──────────────┐
    │   OpenClaw   │   │   OpenClaw   │     │   OpenClaw   │
    │  instance 1  │   │  instance 2  │ ... │  instance N  │
    │  (Railway)   │   │  (Railway)   │     │  (Railway)   │
    └──────────────┘   └──────────────┘     └──────────────┘
```

1. Creates Railway services, provisions tools (OpenRouter keys, AgentMail inboxes, Telnyx numbers), and manages infra — all internally via provider modules in `src/services/`
2. Health-checks `/pool/health` until `ready`, then marks the instance **idle**
3. On `POST /api/pool/claim`, provisions a Convos conversation on the instance and backfills the pool
4. All state lives in a single Postgres database — `instances` (pool lifecycle), `instance_infra` (Railway service details), and `instance_services` (provisioned tools)

## Instance lifecycle

```
starting  →  idle  →  claiming  →  claimed
(building)   (ready)   (atomic)     (in use)
                          ↓
                       crashed
                    (provision failed)
```

State transitions are driven by **Railway webhooks** (push-based, near-real-time):
- `Deployment.deployed` → health-checks the instance, promotes `starting → idle`
- `Deployment.crashed` / `failed` / `oom_killed` → marks unclaimed instances `dead`, claimed instances `crashed`
- `Deployment.slept` → marks instance `sleeping`
- `Deployment.resumed` → health-checks and restores to `idle` or `claimed`

Webhook rules are auto-registered on startup. Instances in `claiming` status are never touched by webhooks (atomic claim in progress). Crashed/dead instances are only marked in the DB — manual cleanup via the dashboard is required.

New instances are created via the admin dashboard or `POST /api/pool/replenish`. Manual recheck via dashboard buttons still works as a fallback.

## Commands

From project root:

| Command | Description |
|--------|-------------|
| `pnpm pool` | Start pool server |
| `pnpm pool:dev` | Start with watch + `pool/.env` |
| `pnpm pool:db:migrate` | Run DB migrations |
| `pnpm pool:test` | Run pool tests |

Or from `pool/`:

| Command | Description |
|--------|-------------|
| `pnpm dev` | Start with watch + `.env` |
| `pnpm start` | Start server |
| `pnpm test` | Run tests |
| `pnpm db:migrate` | Run DB migrations |
| `pnpm db:migrate:drop` | Run migrations + drop legacy columns |

## Setup

Requires Node.js 22+ and a [Railway](https://railway.com) Postgres database.

```sh
cp pool/.env.example pool/.env
pnpm install
cd pool && pnpm db:migrate    # creates instances, instance_infra, instance_services tables
pnpm start
```

To drop legacy columns from an existing DB (after deploying the new code):

```sh
cd pool && pnpm db:migrate:drop
```

## Environment variables

| Variable | Description |
|----------|-------------|
| **Pool manager** | |
| `PORT` | Server port (default `3001`) |
| `POOL_API_KEY` | Shared secret for API auth (Bearer token) |
| `POOL_WEBHOOK_SECRET` | Secret in webhook URL path (defaults to `POOL_API_KEY` if not set) |
| `POOL_URL` | Pool manager's public URL (used by runtime instances for self-destruct and webhook registration) |
| `POOL_STUCK_TIMEOUT_MS` | Max time for instance to pass health checks before marked dead (default `900000` / 15 min) |
| `DATABASE_URL` | Postgres connection string |
| **Railway** | |
| `RAILWAY_TEAM_ID` | Railway team ID (sharded — one project per agent) |
| `RAILWAY_API_TOKEN` | Railway API token for managing services |
| `RAILWAY_RUNTIME_IMAGE` | Runtime Docker image (default `ghcr.io/xmtplabs/convos-runtime:<env>`) |
| **Providers** | |
| `OPENROUTER_MANAGEMENT_KEY` | OpenRouter provisioning key (creates per-instance keys) |
| `AGENTMAIL_API_KEY` | AgentMail API key (provisions per-instance inboxes) |
| `AGENTMAIL_DOMAIN` | AgentMail inbox domain |
| `TELNYX_API_KEY` | Telnyx API key (provisions per-instance phone numbers) |
| `TELNYX_MESSAGING_PROFILE_ID` | Telnyx messaging profile |

## Database

All state is stored in a single Postgres database with three tables. See [`docs/schema.md`](../docs/schema.md) for the full schema.

**`instances`** — pool lifecycle (identity + claim state)

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Instance ID (12-char nanoid) |
| `name` | TEXT | Service name (`convos-agent-{id}`) |
| `url` | TEXT | Public HTTPS URL |
| `status` | TEXT | `starting`, `idle`, `claiming`, `claimed`, `crashed`, `dead`, `sleeping` |
| `agent_name` | TEXT | Name given at claim time |
| `conversation_id` | TEXT | Convos conversation ID |
| `invite_url` | TEXT | Join/invite URL (QR code) |
| `instructions` | TEXT | Custom agent instructions |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `claimed_at` | TIMESTAMPTZ | Claim timestamp |

**`instance_infra`** — Railway service details (service IDs, deploy status, volumes, images)

**`instance_services`** — provisioned tools (OpenRouter keys, AgentMail inboxes, Telnyx numbers)

Claiming is atomic via `SELECT ... FOR UPDATE SKIP LOCKED` — no double-claims possible.

## API

Public endpoints (no auth required): `GET /healthz`, `GET /version`, `GET /api/pool/counts`, `GET /api/pool/agents`, `GET /api/pool/info`, `GET /api/pool/templates`, `GET /api/prompts/:pageId`. All other endpoints require `Authorization: Bearer <POOL_API_KEY>` (or `?key=<POOL_API_KEY>` query param for SSE/EventSource endpoints that can't set headers).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/healthz` | No | Health check (`{"ok": true}`) |
| GET | `/version` | No | Build version and environment |
| GET | `/api/pool/counts` | No | Pool counts only |
| GET | `/api/pool/agents` | No | List all instances by status |
| GET | `/api/pool/info` | No | Environment, branch, model, Railway IDs |
| GET | `/api/pool/templates` | No | Agent template catalog |
| GET | `/api/pool/templates/:slug` | No | Single template by slug |
| GET | `/api/prompts/:pageId` | No | Fetch agent prompt from Notion (cached 1h) |
| GET | `/api/pool/status` | Yes | Pool counts + all instances |
| POST | `/api/pool/claim` | Yes | Claim an idle instance |
| POST | `/api/pool/replenish` | Yes | Trigger poll + replenish; `{"count": N}` to create N directly |
| GET | `/api/pool/replenish/stream?count=N` | Yes | SSE stream of provisioning progress (used by admin dashboard) |
| POST | `/api/pool/drain` | Yes | Remove up to N idle instances: `{"count": N}` |
| POST | `/api/pool/reconcile` | Yes | Reconcile DB against Railway, clean up orphans |
| DELETE | `/api/pool/instances/:id` | Yes | Kill a launched instance |
| DELETE | `/api/pool/crashed/:id` | Yes | Dismiss a crashed agent |
| POST | `/api/pool/self-destruct` | Token | Instance requests own destruction (per-instance gateway token, not `POOL_API_KEY`) |
| POST | `/webhooks/railway/:secret` | URL secret | Railway webhook receiver (secret in URL path must match `POOL_WEBHOOK_SECRET`) |
| GET | `/admin` | Session | Admin dashboard (login with `POOL_API_KEY`) |

### `POST /api/pool/claim`

Creates a conversation (default) or joins an existing one.

```json
{
  "agentName": "tokyo-trip-planner",
  "instructions": "You are a helpful trip planner for Tokyo.",
  "joinUrl": "https://dev.convos.org/v2?i=..."
}
```

`joinUrl` is optional — omit it to create a new conversation.

Response:

```json
{
  "inviteUrl": "https://dev.convos.org/v2?i=...",
  "conversationId": "abc123",
  "instanceId": "rnM8UBQ_fZCz",
  "joined": false,
  "gatewayToken": "<64-char-hex>",
  "gatewayUrl": "https://convos-agent-xxx.up.railway.app"
}
```

### `GET /api/pool/replenish/stream?count=N`

SSE endpoint that streams real-time provisioning progress. Used by the admin dashboard "+ Add" button. Each SSE message is a JSON object:

| Event type | Fields | Description |
|------------|--------|-------------|
| `step` | `instanceNum`, `step`, `status`, `message` | Progress update for a provisioning step |
| `instance` | `instanceNum`, `instance` | Instance successfully created |
| `complete` | `created`, `failed`, `counts` | All instances finished |

Step names: `openrouter`, `agentmail`, `telnyx`, `railway-project`, `railway-service`, `railway-domain`, `done`.

Status values: `active` (in progress), `ok` (success), `fail` (error), `skip` (not configured).

## Environments

| Environment | Pool Manager URL | XMTP Network | Source Branch |
|-------------|-----------------|---------------|---------------|
| dev | `convos-agents-dev.up.railway.app` | dev | *(your branch)* |
| staging | `convos-agents-staging.up.railway.app` | dev | `staging` |
| production | `convos-agents.up.railway.app` | production | `main` |
