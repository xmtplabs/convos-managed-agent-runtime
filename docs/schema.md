# Architecture

## Overview

Single unified service (`pool/`) with one Postgres database. Pool manages instance lifecycle (idle → claimed → destroyed) and all provider interactions (Railway infrastructure, OpenRouter keys, AgentMail inboxes, Telnyx phone numbers). Provider modules live in `pool/src/services/`.

```
Pool Manager
 ├── instance lifecycle (instances table)
 ├── infra management  (instance_infra table)
 ├── tool provisioning (instance_services table)
 └── providers
      ├── Railway     (create/destroy services, deploys, volumes)
      ├── OpenRouter   (per-instance API keys with spending caps)
      ├── AgentMail    (per-instance email inboxes)
      └── Telnyx       (per-instance phone numbers)
```

## Instance Flows

### Warm-up

Pool maintains `POOL_MIN_IDLE` idle instances. Each has a Railway service, deployed runtime image, OpenRouter key, and AgentMail inbox — but no agent name or instructions.

```
Pool: "2 idle, need 5 → creating 3"

Pool: calls infra.createInstance(instanceId, name, tools)
  → creates Railway service + environment + volume + domain
  → provisions OpenRouter key + AgentMail inbox
  → sets all env vars on Railway service
  → stores in instance_infra + instance_services tables
  → returns {instanceId, serviceId, url, services}

Pool: INSERT instances (id, name, status='starting', url)
```

### Tick (Health Check)

Pool polls fleet health every tick via batch Railway API queries.

```
Pool: fetches all convos-agent-* Railway services in current env
Pool: checks deploy status + pings /pool/health (40 concurrent)
Pool: reconciles DB state:
  starting + healthy → idle
  unreachable > POOL_STUCK_TIMEOUT_MS → dead → destroy
  replenish to POOL_MIN_IDLE
```

### Claim

User requests an agent via dashboard or API.

```
Dashboard → POST /api/pool/claim {agentName, instructions, joinUrl?}

Pool: SELECT ... WHERE status='idle' FOR UPDATE SKIP LOCKED
Pool: UPDATE status='claiming'
Pool: upserts env vars on Railway service via configure()
Pool: provisions conversation via runtime /pool/provision endpoint
Pool: UPDATE status='claimed', agent_name, conversation_id, invite_url
Pool → {inviteUrl, instanceId}
```

### Destruction

```
Pool: calls infra.destroyInstance(instanceId)
  → deletes OpenRouter key, AgentMail inbox, Telnyx phone
  → deletes Railway volumes + service
  → deletes all DB rows (cascade from instance_infra)

Pool: DELETE FROM instances WHERE id = :instanceId
```

## Services Routes (internal)

These routes are mounted on the pool Express app. Auth: `Authorization: Bearer POOL_API_KEY`.

| Method | Path | Purpose |
|--------|----------|---------|
| `POST` | `/create-instance` | Create Railway service + provision base tools |
| `DELETE` | `/destroy/:instanceId` | Full teardown (tools + infra + DB) |
| `POST` | `/status/batch` | Batch deploy status for all agent services |
| `POST` | `/configure/:instanceId` | Upsert env vars on Railway service |
| `POST` | `/redeploy/:instanceId` | Trigger redeployment |
| `POST` | `/provision/:instanceId/:toolId` | Provision a single tool |
| `DELETE` | `/destroy/:instanceId/:toolId/:resourceId` | Destroy a single tool |

## Database

Single Postgres database with three tables.

### `instances` (pool lifecycle)

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | 12-char nanoid |
| `name` | text NOT NULL | `convos-agent-{id}` |
| `url` | text | public Railway URL |
| `status` | text NOT NULL | `starting` / `idle` / `claiming` / `claimed` / `crashed` |
| `agent_name` | text | set at claim |
| `conversation_id` | text | set at claim |
| `invite_url` | text | set at claim |
| `instructions` | text | set at claim |
| `created_at` | timestamptz | |
| `claimed_at` | timestamptz | |

### `instance_infra` (Railway service details)

| Column | Type | Notes |
|--------|------|-------|
| `instance_id` | text PK | correlation key with `instances.id` |
| `provider` | text NOT NULL | `'railway'` |
| `provider_service_id` | text NOT NULL UNIQUE | Railway service ID |
| `provider_env_id` | text NOT NULL | Railway environment ID |
| `provider_project_id` | text | Railway project ID |
| `url` | text | public URL |
| `deploy_status` | text | from Railway API |
| `runtime_image` | text | GHCR image tag (`RAILWAY_RUNTIME_IMAGE`) |
| `volume_id` | text | Railway volume ID |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### `instance_services` (provisioned tools)

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `instance_id` | text FK | CASCADE on delete from `instance_infra` |
| `tool_id` | text NOT NULL | `openrouter` / `agentmail` / `telnyx` |
| `resource_id` | text NOT NULL | key hash, inbox ID, phone number |
| `resource_meta` | jsonb | tool-specific metadata |
| `env_key` | text NOT NULL | env var name on Railway |
| `env_value` | text | the secret value |
| `status` | text NOT NULL | `active` / `destroyed` |
| `created_at` | timestamptz | |

Unique: `(instance_id, tool_id)` — one tool per type per instance.

### Rules

- Cleanup is explicit: pool destroys infra + tools before removing its own `instances` row
- New tool type = new `tool_id` value, no schema migration
- `instance_services` cascades on `instance_infra` delete
