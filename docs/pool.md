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

1. Creates Railway services from `agent/` (Dockerfile + entrypoint that builds and runs OpenClaw)
2. Polls `/convos/status` until `ready`, then marks the instance **idle**
3. On `POST /api/pool/claim`, provisions a Convos conversation on the instance and backfills the pool
4. Claimed instances are renamed in Railway for dashboard visibility

## Instance lifecycle

```
starting  →  idle  →  claimed
(building)   (ready)   (in use)
```

The background tick runs every 30 seconds:
1. Polls instances — if `/convos/status` returns `ready`, marks them `idle`
2. If idle + starting < `POOL_MIN_IDLE`, creates new instances to fill the gap
3. Instances that never pass health checks within `POOL_STUCK_TIMEOUT_MS` are marked dead and deleted

## Setup

Requires Node.js 22+ and a [Railway](https://railway.com) Postgres database.

```sh
cp pool/.env.example pool/.env
pnpm install
pnpm run db:migrate
pnpm start
```

## Environment variables

See [`pool/.env.example`](../pool/.env.example) for the full list. Key variables:

| Variable | Description |
|----------|-------------|
| `POOL_API_KEY` | Shared secret for API auth (Bearer token) |
| `POOL_ENVIRONMENT` | `"staging"`, `"dev"`, or `"production"` |
| `POOL_MIN_IDLE` | Minimum idle instances to maintain (default `1`) |
| `DATABASE_URL` | Railway postgres connection string |
| `RAILWAY_API_TOKEN` | Railway project-scoped API token |
| `OPENROUTER_MANAGEMENT_KEY` | Management key for creating per-instance API keys |

Instance env vars and other pool/Railway settings are documented in the `.env.example`.

## Database

Postgres table: `agent_metadata`. Created/migrated automatically on startup (`pool/src/db/migrate.js`).

If upgrading from an older version with `pool_instances`, the migration renames the table, drops unused columns (`railway_url`, `status`, `health_check_failures`, `updated_at`, `join_url`), renames `claimed_by` to `agent_name`, and removes non-claimed rows.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | TEXT PK | Instance ID |
| `railway_service_id` | TEXT | Railway service ID |
| `agent_name` | TEXT | Name assigned on claim |
| `conversation_id` | TEXT | Convos conversation ID |
| `invite_url` | TEXT | Convos invite URL |
| `instructions` | TEXT | Agent instructions |
| `created_at` | TIMESTAMPTZ | When the instance was created |
| `claimed_at` | TIMESTAMPTZ | When the instance was claimed |
| `source_branch` | TEXT | Git branch the instance was deployed from (`RAILWAY_GIT_BRANCH`) |
| `openrouter_key_hash` | TEXT | OpenRouter key hash for cleanup on delete |
| `agentmail_inbox_id` | TEXT | AgentMail inbox ID for cleanup on delete |

Migration is idempotent — safe to re-run. New columns are added via `ADD COLUMN IF NOT EXISTS`.

## AgentMail inbox management

Two modes, controlled by `AGENTMAIL_INBOX_ID`:

| Mode | Env var | Behavior |
|------|---------|----------|
| **Shared inbox** | `AGENTMAIL_INBOX_ID` set | All instances use this inbox. No inboxes created or deleted by the pool. |
| **Per-instance inbox** | `AGENTMAIL_INBOX_ID` unset | Each instance gets its own inbox via AgentMail API on provision. Deleted on instance cleanup. |

Per-instance inboxes use the username format `convos-<hex>` with an optional custom domain (`AGENTMAIL_DOMAIN`). The `agentmail_inbox_id` column in `agent_metadata` tracks which inbox belongs to which instance for cleanup.

## Gateway config for Railway

Instances deployed on Railway need specific gateway config in `openclaw/openclaw.json` to work behind Railway's reverse proxy. See [docs/security.md](security.md) for details.

```json
{
  "gateway": {
    "trustedProxies": ["::1", "127.0.0.1"],
    "controlUi": {
      "allowInsecureAuth": true,
      "dangerouslyDisableDeviceAuth": true
    }
  }
}
```

- **`trustedProxies`** — tells the gateway to trust proxy headers from Railway's reverse proxy on loopback
- **`dangerouslyDisableDeviceAuth`** — disables device identity pairing for the Control UI (required since device pairing can't complete through Railway's proxy)

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
