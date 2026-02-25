# Convos Agent Pool Manager

Manages pre-warmed [OpenClaw](https://github.com/xmtplabs/openclaw) agent instances on [Railway](https://railway.com). Instances are created ahead of time so claiming one takes seconds, not minutes.

## How it works

```
                         ┌──────────────┐
                         │  Pool Manager │
                         │  (this repo)  │
                         └──┬───┬───┬───┘
               creates      │   │   │      polls /convos/status
            ┌───────────────┘   │   └───────────────┐
            ▼                   ▼                    ▼
    ┌──────────────┐   ┌──────────────┐     ┌──────────────┐
    │   OpenClaw   │   │   OpenClaw   │     │   OpenClaw   │
    │  instance 1  │   │  instance 2  │ ... │  instance N  │
    │  (Railway)   │   │  (Railway)   │     │  (Railway)   │
    └──────────────┘   └──────────────┘     └──────────────┘
```

1. Creates Railway services from a pre-built GHCR image (`ghcr.io/xmtplabs/convos-runtime`, see [runtime.md](./runtime.md))
2. Health-checks `/pool/health` until `ready`, then marks the instance **idle**
3. On `POST /api/pool/claim`, provisions a Convos conversation on the instance and backfills the pool
4. All instance state lives in a Postgres `instances` table — no in-memory cache

## Instance lifecycle

```
starting  →  idle  →  claimed
(building)   (ready)   (in use)
```

The background tick runs every 30 seconds:
1. Fetches all services from Railway, reconciles with the `instances` DB table
2. Health-checks deployed instances — if `/pool/health` returns `ready`, marks them `idle`
3. Dead/stuck unclaimed instances are deleted; dead claimed instances are marked `crashed`
4. Orphaned DB rows (service gone from Railway) are cleaned up
5. If idle + starting < `POOL_MIN_IDLE`, creates new instances to fill the gap

## Setup

Requires Node.js 22+ and a [Railway](https://railway.com) Postgres database.

```sh
cp pool/.env.example pool/.env
pnpm install
pnpm run db:migrate    # creates instances + agent_metadata tables
pnpm start
```

To backfill existing instances with data from Railway API (url, gateway_token, agentmail_inbox_id, runtime_image):

```sh
pnpm run db:enrich             # fill missing fields
pnpm run db:enrich --dry-run   # preview changes
pnpm run db:enrich --all       # re-fetch all rows
```

The enrich script supports `RAILWAY_ENVIRONMENT_NAME` (e.g. `scaling`, `dev`) as an alternative to `RAILWAY_ENVIRONMENT_ID`. You can also chain env files for cross-environment runs:

```sh
node --env-file=.env --env-file=../.env.dev src/db/enrich-instances.js --dry-run
```

## Environment variables

| Variable | Description |
|----------|-------------|
| **Pool manager** | |
| `PORT` | Server port (default `3001`) |
| `POOL_API_KEY` | Shared secret for API auth (Bearer token) |
| `POOL_ENVIRONMENT` | `"staging"`, `"dev"`, or `"production"` |
| `POOL_MIN_IDLE` | Minimum idle instances to maintain (default `3`) |
| `POOL_STUCK_TIMEOUT_MS` | Max time for instance to pass health checks before marked dead (default `900000` / 15 min) |
| `TICK_INTERVAL_MS` | Background tick interval (default `30000`) |
| `DATABASE_URL` | Railway postgres connection string |
| **Railway** | |
| `RAILWAY_API_TOKEN` | Railway project-scoped API token |
| `RAILWAY_PROJECT_ID` | Railway project ID |
| `RAILWAY_ENVIRONMENT_ID` | Railway environment ID (or use `RAILWAY_ENVIRONMENT_NAME`) |
| `RAILWAY_ENVIRONMENT_NAME` | Environment name (e.g. `scaling`, `dev`) — resolved to ID automatically |
| `RAILWAY_RUNTIME_IMAGE` | Override runtime image (defaults to `ghcr.io/xmtplabs/convos-runtime:latest`). See [runtime.md](./runtime.md) |
| **OpenRouter** | |
| `OPENROUTER_MANAGEMENT_KEY` | Management key for creating per-instance API keys |
| `OPENROUTER_KEY_LIMIT` | USD spend limit per key (default `20`) |
| `OPENROUTER_KEY_LIMIT_RESET` | Limit reset period (default `monthly`) |
| **Agent keys** | Passed directly to runtime instances |
| `OPENCLAW_PRIMARY_MODEL` | Primary model for the agent |
| `XMTP_ENV` | XMTP environment (`dev` or `production`) |
| `AGENTMAIL_API_KEY` | AgentMail API key (per-instance inboxes created automatically) |
| `AGENTMAIL_DOMAIN` | Custom domain for inboxes (e.g. `mail.convos.org`); defaults to `agentmail.to` |
| `BANKR_API_KEY` | Bankr API key |
| `TELNYX_API_KEY` | Telnyx API key |
| `TELNYX_PHONE_NUMBER` | Telnyx phone number |
| `TELNYX_MESSAGING_PROFILE_ID` | Telnyx messaging profile ID |

## Database

All instance state is stored in a Postgres `instances` table. The tick loop reconciles it with Railway on every cycle.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Instance ID (12-char nanoid) |
| `service_id` | TEXT UNIQUE | Railway service ID |
| `name` | TEXT | Service name (`convos-agent-{id}`) |
| `url` | TEXT | Public HTTPS URL |
| `status` | TEXT | `starting`, `idle`, `claiming`, `claimed`, `crashed` |
| `deploy_status` | TEXT | Railway deploy status (`BUILDING`, `SUCCESS`, etc.) |
| `agent_name` | TEXT | Name given at claim time |
| `conversation_id` | TEXT | Convos conversation ID |
| `invite_url` | TEXT | Join/invite URL (QR code) |
| `instructions` | TEXT | Custom agent instructions |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `claimed_at` | TIMESTAMPTZ | Claim timestamp |
| `source_branch` | TEXT | Git branch at claim time |
| `runtime_image` | TEXT | Docker image used (e.g. `ghcr.io/.../convos-runtime:latest`) |
| `openrouter_key_hash` | TEXT | OpenRouter key hash (for cleanup) |
| `agentmail_inbox_id` | TEXT | AgentMail inbox address |
| `gateway_token` | TEXT | Gateway auth token |

Claiming is atomic via `SELECT ... FOR UPDATE SKIP LOCKED` — no double-claims possible.

## API

All endpoints except `GET /` and `GET /healthz` require `Authorization: Bearer <POOL_API_KEY>`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Web dashboard |
| GET | `/healthz` | Health check (`{"ok": true}`) |
| GET | `/api/pool/status` | Pool counts + all instances |
| GET | `/api/pool/counts` | Pool counts only (no auth) |
| POST | `/api/pool/claim` | Claim an idle instance |
| POST | `/api/pool/replenish` | Trigger poll + replenish; `{"count": N}` to create N directly |
| POST | `/api/pool/drain` | Remove up to N idle instances: `{"count": N}` |
| POST | `/api/pool/reconcile` | Reconcile DB against Railway, clean up orphans |

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

## Environments

| Environment | Pool Manager URL | XMTP Network | Source Branch |
|-------------|-----------------|---------------|---------------|
| dev | `convos-agents-dev.up.railway.app` | dev | *(your branch)* |
| staging | `convos-agents-dev.up.railway.app` | dev | `staging` |
| production | `convos-agents.up.railway.app` | production | `main` |
