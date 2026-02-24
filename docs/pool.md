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
| `RAILWAY_ENVIRONMENT_ID` | Railway environment ID |
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
