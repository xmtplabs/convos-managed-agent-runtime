# Services API

Manages all provider interactions (Railway, OpenRouter, AgentMail, Telnyx) on behalf of the pool manager. Owns the infra and tool provisioning data in its own Postgres DB.

## How it works

The pool manager delegates all provider calls through this API:

```
Pool Manager  ──HTTP──▶  Services API  ──GQL/REST──▶  Railway, OpenRouter, AgentMail, Telnyx
```

- **Create instance**: provisions a Railway service, OpenRouter key, AgentMail inbox, and (optionally) Telnyx phone number
- **Destroy instance**: tears down all resources in reverse
- **Batch status**: returns deploy status for all agent services (pool uses this for its tick loop)
- **Configure**: sets env vars on a running instance
- **Redeploy**: triggers a redeploy of the latest deployment

## Setup

```sh
cp services/.env.example services/.env
cd services
pnpm install
pnpm build
pnpm db:migrate        # creates instance_infra + instance_services tables
pnpm start
```

To drop legacy columns from existing DBs:

```sh
pnpm db:migrate:drop   # drops legacy columns from services DB + pool DB (if POOL_DATABASE_URL set)
```

## Environment variables

| Variable | Description |
|----------|-------------|
| **Services** | |
| `PORT` | Server port (default `3002`) |
| `SERVICES_API_KEY` | Shared secret for API auth (Bearer token) |
| **Database** | |
| `SERVICE_DATABASE_URL` | Services Postgres connection string |
| `POOL_DATABASE_URL` | Pool Postgres connection string (optional — for backfill + `--drop`) |
| **Railway** | |
| `RAILWAY_API_TOKEN` | Railway project-scoped API token |
| `RAILWAY_PROJECT_ID` | Railway project ID |
| `RAILWAY_ENVIRONMENT_ID` | Railway environment ID (or use `RAILWAY_ENVIRONMENT_NAME`) |
| `RAILWAY_ENVIRONMENT_NAME` | Environment name (e.g. `scaling`, `dev`) — resolved to ID automatically |
| `RAILWAY_RUNTIME_IMAGE` | Override runtime image (defaults to `ghcr.io/xmtplabs/convos-runtime:latest`) |
| **OpenRouter** | |
| `OPENROUTER_MANAGEMENT_KEY` | Management key for creating per-instance API keys |
| `OPENROUTER_KEY_LIMIT` | USD spend limit per key (default `20`) |
| `OPENROUTER_KEY_LIMIT_RESET` | Limit reset period (default `monthly`) |
| **AgentMail** | |
| `AGENTMAIL_API_KEY` | AgentMail API key (per-instance inboxes created automatically) |
| `AGENTMAIL_DOMAIN` | Custom domain for inboxes (e.g. `mail.convos.org`) |
| **Telnyx** | |
| `TELNYX_API_KEY` | Telnyx API key |
| **Instance env vars** (passed through to runtime) | |
| `OPENCLAW_PRIMARY_MODEL` | Primary model for the agent |
| `XMTP_ENV` | XMTP environment (`dev` or `production`) |
| `POOL_API_KEY` | Shared pool secret (passed to instances for health check auth) |
| `BANKR_API_KEY` | Bankr API key |
| `TELNYX_PHONE_NUMBER` | Telnyx phone number |
| `TELNYX_MESSAGING_PROFILE_ID` | Telnyx messaging profile ID |

## Database

Services owns two tables in its Postgres DB.

### `instance_infra`

Tracks the infrastructure backing each instance.

| Column | Type | Description |
|--------|------|-------------|
| `instance_id` | TEXT PK | Instance ID (matches pool's `instances.id`) |
| `provider` | TEXT | Provider name (default `railway`) |
| `provider_service_id` | TEXT UNIQUE | Railway service ID |
| `provider_env_id` | TEXT | Railway environment ID |
| `provider_project_id` | TEXT | Railway project ID |
| `url` | TEXT | Public HTTPS URL |
| `deploy_status` | TEXT | Deploy status (`BUILDING`, `SUCCESS`, etc.) |
| `runtime_image` | TEXT | Docker image used |
| `volume_id` | TEXT | Railway volume ID |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp |

### `instance_services`

Tracks provisioned tool resources per instance. Cascades on delete from `instance_infra`.

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL PK | Auto-increment ID |
| `instance_id` | TEXT FK | References `instance_infra(instance_id)` |
| `tool_id` | TEXT | Tool name (`openrouter`, `agentmail`, `telnyx`) |
| `resource_id` | TEXT | Provider resource ID (key hash, inbox ID, phone number) |
| `resource_meta` | JSONB | Additional metadata |
| `env_key` | TEXT | Env var name set on the instance |
| `env_value` | TEXT | Env var value (nullable) |
| `status` | TEXT | `active` (default) |
| `created_at` | TIMESTAMPTZ | Creation timestamp |

Unique constraint on `(instance_id, tool_id)`.

## API

All endpoints require `Authorization: Bearer <SERVICES_API_KEY>` except `GET /healthz`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/healthz` | Health check |
| GET | `/registry` | List available tools and their env keys |
| POST | `/create-instance` | Create Railway service + provision tools |
| DELETE | `/destroy/:instanceId` | Destroy all resources for an instance |
| POST | `/status/batch` | Batch deploy status for all agent services |
| POST | `/configure/:instanceId` | Set env vars on an instance |
| POST | `/redeploy/:instanceId` | Trigger redeploy |

### `POST /status/batch`

Returns deploy status for all (or filtered) agent services.

```json
{
  "projectId": "proj-abc123",
  "services": [
    {
      "instanceId": "rnM8UBQ_fZCz",
      "serviceId": "svc-xyz789",
      "name": "convos-agent-rnM8UBQ_fZCz",
      "deployStatus": "SUCCESS",
      "domain": "convos-agent-rnM8UBQ_fZCz.up.railway.app",
      "image": "ghcr.io/xmtplabs/convos-runtime:latest",
      "environmentIds": ["env-001"]
    }
  ]
}
```

### Migration: `--drop`

`pnpm db:migrate:drop` drops legacy columns from both DBs:

**Services DB** (`instance_infra`): `gateway_token`, `setup_password`, `wallet_key`

**Pool DB** (`instances`): `service_id`, `deploy_status`, `volume_id`, `runtime_image`, `openrouter_key_hash`, `agentmail_inbox_id`, `gateway_token`, `source_branch`
