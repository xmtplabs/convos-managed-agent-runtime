# Pool

Manages pre-warmed [OpenClaw](https://github.com/xmtplabs/openclaw) agent instances on [Railway](https://railway.com). Instances are created ahead of time so claiming one takes seconds, not minutes.

Pool delegates all provider interactions (Railway, OpenRouter, AgentMail, Telnyx) to the [services API](../services/README.md).

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

1. Delegates to the **services API** to create Railway services, provision tools (OpenRouter keys, AgentMail inboxes), and manage infra
2. Health-checks `/pool/health` until `ready`, then marks the instance **idle**
3. On `POST /api/pool/claim`, provisions a Convos conversation on the instance and backfills the pool
4. All instance state lives in a Postgres `instances` table — no in-memory cache
5. Infra details (service IDs, deploy status, volumes, images) live in the **services DB** — pool only tracks instance identity and claim state

## Instance lifecycle

```
starting  →  idle  →  claimed
(building)   (ready)   (in use)
```

The background tick runs every 30 seconds:
1. Fetches batch status from the **services API** (deploy status, domains, images), reconciles with the `instances` DB table by `instanceId`
2. Health-checks deployed instances — if `/pool/health` returns `ready`, marks them `idle`
3. Dead/stuck unclaimed instances are deleted via services API; dead claimed instances are marked `crashed`
4. Orphaned DB rows (instance gone from Railway) are cleaned up
5. If idle + starting < `POOL_MIN_IDLE`, creates new instances to fill the gap

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

## Setup

Requires Node.js 22+ and a [Railway](https://railway.com) Postgres database.

```sh
cp pool/.env.example pool/.env
pnpm install
pnpm run db:migrate    # creates instances table
pnpm start
```

To drop legacy columns from an existing DB (after deploying the new code):

```sh
cd services && pnpm db:migrate:drop   # drops legacy columns from both services + pool DBs
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
| `POOL_DATABASE_URL` | Railway postgres connection string |
| **Services API** | |
| `SERVICES_URL` | Services API base URL (e.g. `http://services.railway.internal:3002`) |
| `SERVICES_API_KEY` | Shared secret for services API auth |
| **Railway** (dashboard links only) | |
| `RAILWAY_PROJECT_ID` | Railway project ID (for pool manager's own dashboard link) |
| `RAILWAY_ENVIRONMENT_ID` | Railway environment ID (for tick loop + dashboard links) |

## Database

Pool instance state is stored in a Postgres `instances` table. The tick loop reconciles it with the services batch status API on every cycle. Infra details (service IDs, deploy status, volumes, images) live in the **services DB** — see [services README](../services/README.md).

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Instance ID (12-char nanoid) |
| `name` | TEXT | Service name (`convos-agent-{id}`) |
| `url` | TEXT | Public HTTPS URL |
| `status` | TEXT | `starting`, `idle`, `claiming`, `claimed`, `crashed` |
| `agent_name` | TEXT | Name given at claim time |
| `conversation_id` | TEXT | Convos conversation ID |
| `invite_url` | TEXT | Join/invite URL (QR code) |
| `instructions` | TEXT | Custom agent instructions |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `claimed_at` | TIMESTAMPTZ | Claim timestamp |

Claiming is atomic via `SELECT ... FOR UPDATE SKIP LOCKED` — no double-claims possible.

## API

All endpoints except `GET /` and `GET /healthz` require `Authorization: Bearer <POOL_API_KEY>`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Web dashboard |
| GET | `/healthz` | Health check (`{"ok": true}`) |
| GET | `/version` | Build version and environment |
| GET | `/api/pool/status` | Pool counts + all instances |
| GET | `/api/pool/counts` | Pool counts only (no auth) |
| GET | `/api/pool/agents` | List claimed and crashed agents (no auth) |
| POST | `/api/pool/claim` | Claim an idle instance |
| POST | `/api/pool/replenish` | Trigger poll + replenish; `{"count": N}` to create N directly |
| POST | `/api/pool/drain` | Remove up to N idle instances: `{"count": N}` |
| POST | `/api/pool/reconcile` | Reconcile DB against Railway, clean up orphans |
| DELETE | `/api/pool/instances/:id` | Kill a launched instance |
| DELETE | `/api/pool/crashed/:id` | Dismiss a crashed agent |

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
