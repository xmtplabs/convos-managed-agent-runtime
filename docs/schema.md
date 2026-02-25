# Architecture

## Overview

Two services with separate databases. Pool manages instance lifecycle (idle → claimed → destroyed). Services manages infrastructure (Railway, tool provisioning). Only shared value is `instance_id` (12-char nanoid).

```
Pool  ──HTTP──▶  Services  ──API──▶  Railway / OpenRouter / AgentMail / Telnyx
 │                  │
 ▼                  ▼
Pool DB          Services DB
(instances)      (instance_infra + instance_services)
```

## Instance Flows

### Warm-up

Pool maintains `POOL_MIN_IDLE` idle instances. Each has a Railway service, deployed runtime image, OpenRouter key, and AgentMail inbox — but no agent name or instructions.

```
Pool: "2 idle, need 5 → creating 3"

Pool → POST /create-instance {instanceId, name, tools: ["openrouter","agentmail"]}
  Services: creates Railway service + environment + volume + domain
  Services: provisions OpenRouter key + AgentMail inbox
  Services: sets all env vars on Railway service
  Services: stores in instance_infra + instance_services
  Services → {instanceId, serviceId, url, services}

Pool: INSERT instances (id, name, status='starting', url)
```

### Tick (Health Check)

Pool polls fleet health every tick via a single batch call.

```
Pool → POST /status/batch
  Services: lists all convos-agent-* Railway services in current env
  Services: checks deploy status + pings /pool/health (40 concurrent)
  Services → {abc123: {status:"SUCCESS", healthy:true}, ...}

Pool: starting + healthy → idle
Pool: unreachable > POOL_STUCK_TIMEOUT_MS → dead → destroy
Pool: replenish to POOL_MIN_IDLE
```

### Claim

User requests an agent via dashboard or API.

```
Dashboard → POST /api/pool/claim {agentName, instructions, joinUrl?}

Pool: SELECT ... WHERE status='idle' FOR UPDATE SKIP LOCKED
Pool: UPDATE status='claiming'
Pool → POST /configure/:instanceId {variables: {...}}
  Services: upserts env vars on Railway service
Pool: provisions conversation via runtime /pool/provision endpoint
Pool: UPDATE status='claimed', agent_name, conversation_id, invite_url
Pool → {inviteUrl, instanceId}
```

### Destruction

```
Pool → DELETE /destroy/:instanceId
  Services: deletes OpenRouter key, AgentMail inbox, Telnyx phone
  Services: deletes Railway volumes + service
  Services: deletes all DB rows (cascade)

Pool: DELETE FROM instances WHERE id = :instanceId
```

## Internal API (Services Routes)

Auth: `Authorization: Bearer POOL_API_KEY`

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/create-instance` | Create Railway service + provision base tools |
| `DELETE` | `/destroy/:instanceId` | Full teardown (tools + infra + DB) |
| `POST` | `/status/batch` | Batch deploy status for all agent services |
| `POST` | `/configure/:instanceId` | Upsert env vars on Railway service |
| `POST` | `/redeploy/:instanceId` | Trigger redeployment |
| `POST` | `/provision/:instanceId/:toolId` | Provision a single tool |
| `DELETE` | `/destroy/:instanceId/:toolId/:resourceId` | Destroy a single tool |

## Databases

Separate Postgres instances. No shared tables, no cross-DB queries.

### Pool DB

**`instances`**

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

### Services DB

**`instance_infra`**

| Column | Type | Notes |
|--------|------|-------|
| `instance_id` | text PK | correlation key with pool |
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

**`instance_services`**

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `instance_id` | text FK | CASCADE on delete |
| `tool_id` | text NOT NULL | `openrouter` / `agentmail` / `telnyx` |
| `resource_id` | text NOT NULL | key hash, inbox ID, phone number |
| `resource_meta` | jsonb | tool-specific metadata |
| `env_key` | text NOT NULL | env var name on Railway |
| `env_value` | text | the secret value |
| `status` | text NOT NULL | `active` / `destroyed` |
| `created_at` | timestamptz | |

Unique: `(instance_id, tool_id)` — one tool per type per instance.

### Rules

- Pool never sees Railway IDs — only `instance_id` and `url`
- Cleanup is explicit: pool calls `DELETE /destroy/:instanceId` before removing its own row
- New tool type = new `tool_id` value, no schema migration
- `instance_services` cascades on `instance_infra` delete
