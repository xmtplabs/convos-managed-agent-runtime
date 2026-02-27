# Architecture

The end-state architecture after all phases are complete.

**Last updated:** 2026-02-24 (Phase 0 complete)

---

## High-Level Architecture

Three independent deployables, each with its own Railway instance, Dockerfile, and DB (where applicable). Every agent gets its own Railway project deployed from a pre-built GHCR image.

**Pool** — the orchestrator and public API. Owns the concept of a "pool" of warm instances, handles claiming, template logic, and pool sizing. Exposes the REST API that the dashboard and external clients consume. Decides **what** to do and **when** — never talks to Railway or any external API directly. Calls services for all external operations.

**Services** — the external API layer. Talks to Railway, OpenRouter, AgentMail, Telnyx, Bankr. Knows **how** to create a Railway project, provision an email inbox, or destroy a phone number. Owns all Railway concepts including `railway_project_id`. Has its own DB for tracking provisioned resources and infra state.

**Runtime** — the agent instance. A pre-built Docker image (published to GHCR) that Railway pulls and runs. Contains the OpenClaw gateway, extensions (convos channel, web-tools), workspace, and CLI. Configured entirely via environment variables injected by services at provision time. One Railway project per runtime instance — no shared private network.

```
                                    ┌──────────────┐
                                    │  GitHub GHCR  │
                                    │  (pre-built   │
                                    │   runtime)    │
                                    └──────┬───────┘
                                           │ pull image
┌──────────┐     HTTP      ┌────────────┐  │  ┌──────────────────────┐
│   pool   │ ────────────► │  services  │──┴─►│ Railway project (1)  │
│ (router) │               │ (ext APIs) │────►│ Railway project (2)  │
└────┬─────┘               └─────┬──────┘────►│ Railway project (N)  │
     │                           │            └──────────────────────┘
     ▼                           ▼               one project per agent
┌──────────┐               ┌────────────┐
│ pool DB  │               │services DB │
└──────────┘               └────────────┘
```

---

## Structure

```
convos-agents/
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── pool/                    # Express API server (pure routing, no external APIs)
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts
│       ├── pool.ts
│       ├── cache.ts
│       ├── provision.ts     # calls services via HTTP
│       ├── status.ts
│       ├── naming.ts
│       ├── routes/
│       │   ├── claim.ts
│       │   └── templates.ts
│       └── db/
│           ├── connection.ts
│           ├── instances.ts
│           ├── templates.ts
│           └── migrate.ts
├── services/                # All external integrations (own Railway instance)
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts         # Express server + internal API routes
│       ├── registry.ts      # register(), getAll(), getByToolId()
│       ├── db/
│       │   ├── connection.ts
│       │   ├── instance-infra.ts
│       │   ├── instance-services.ts
│       │   └── migrate.ts
│       ├── infra/
│       │   └── railway.ts   # project lifecycle (create, destroy, deploy, volumes, GHCR config)
│       └── plugins/
│           ├── openrouter.ts
│           ├── agentmail.ts
│           ├── telnyx.ts
│           ├── bankr.ts
│           └── wallet.ts
├── dashboard/               # React + Vite SPA
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── src/
│       ├── main.tsx
│       └── ...
├── runtime/                 # Agent runtime (deployed instances)
│   ├── Dockerfile           # builds from repo root context
│   ├── package.json         # openclaw + deps (agentmail, telnyx, bankr, etc.)
│   ├── openclaw/            # extensions + workspace + config template
│   │   ├── openclaw.json    # config with ${ENV_VAR} placeholders
│   │   ├── extensions/      # convos channel, web-tools
│   │   └── workspace/       # agent identity, skills, tools
│   └── scripts/             # entrypoint, keys, gateway, apply-config
│       ├── entrypoint.sh    # Railway volume setup
│       ├── keys.sh          # provision/display all env vars
│       ├── apply-config.sh  # sync workspace + extensions to state dir
│       ├── gateway.sh       # start openclaw gateway with restart loop
│       └── lib/             # init, paths, env-load, node-path, sync
├── .github/workflows/
│   └── build-runtime.yml    # CI: build + push to ghcr.io/xmtplabs/convos-runtime
```

---

## Services API

Two route groups: infra lifecycle and tool provisioning.

**Auth:**
- Pool→services: `SERVICES_API_KEY` header (shared secret, set in both pool and services env)
- Runtime→services (self-provision): `INSTANCE_SERVICES_TOKEN` header. Services generates a per-instance token at creation time and injects it into the runtime as an env var. Services validates the token against the `instance_infra` row.

### Infra Lifecycle

```
POST   /create-instance                 # create Railway project + deploy GHCR image + provision OpenRouter + wallet
       body: {instanceId}
       returns: {instanceId, url}

DELETE /destroy/:instanceId             # cleanup external resources + projectDelete
       returns: {ok}

POST   /status/batch                    # batch health + deploy status check
       body: {instanceIds: string[]}
       returns: {[instanceId]: "deploying" | "deploy_failed" | "healthy" | "unreachable"}

POST   /redeploy/:instanceId           # trigger redeployment (new image pull)
       returns: {ok}
```

### Tool Provisioning

```
POST   /provision/:instanceId/:toolId  # provision a specific tool for an instance
       body: {userConfig?}             # optional user-supplied credentials for "provisioning":"user" tools
       returns: {resourceId, config}

DELETE /destroy/:instanceId/:toolId/:resourceId  # destroy a specific provisioned resource
       returns: {ok}

POST   /configure/:instanceId          # push instructions, name, model to running instance
       body: {instructions, agentName, model}
       returns: {ok, conversationId, inviteUrl}

GET    /registry                        # list available tools and their provisioning modes
       returns: [{toolId, name, provisioning}]
```

### Plugin Interface

Each plugin implements:
- `create(instanceId)` → provisions the resource, returns `{resourceId, config, envVars}`
- `update(instanceId, config)` → updates configuration
- `destroy(resourceId)` → tears down the resource

| Plugin | toolId | Always provisioned? |
|--------|--------|-------------------|
| OpenRouter | — | Yes (at instance creation) |
| Wallet | — | Yes (at instance creation) |
| AgentMail | `"email"` | Only if declared in template |
| Telnyx | `"sms"` | Only if declared in template |
| Bankr | `"crypto"` | Only if declared in template |

---

## Instance Flows

Pool talks to services via generic operations. Services is the only thing that knows Railway exists. If the provider changes, only services changes.

### Warm-up

Pool maintains `POOL_MIN_IDLE` bare instances. Each idle instance has a Railway project, deployed GHCR image, OpenRouter key, and wallet — but no template, no agent name, no specialized tools.

```
Pool: "I have 2 idle, need 5. Creating 3 more."

Pool → POST services/create-instance {instanceId: "abc123"}
  Services: projectCreate → new Railway project
  Services: create environment matching RAILWAY_ENVIRONMENT_NAME
  Services: configure GHCR registry credentials on project
  Services: provisions OpenRouter key + wallet
  Services: generates INSTANCE_SERVICES_TOKEN for runtime→services auth
  Services: sets all env vars on the Railway service (including INSTANCE_SERVICES_TOKEN)
  Services: serviceCreate → deploy from GHCR image (no build, ~20-30s)
  Services: stores project ID, URL, token, resource IDs in services DB (instance_infra + instance_services)
  Services → {instanceId: "abc123", url: "https://abc123.up.railway.app"}

Pool: INSERT INTO instances (id, status, url) VALUES ("abc123", "starting", "...")

... tick runs ...

Pool → POST services/status/batch {instanceIds: ["abc123", "def456", "ghi789"]}
  Services: looks up Railway project IDs in services DB
  Services: checks deploy status + pings health endpoints (40 concurrent)
  Services → {abc123: "healthy", def456: "healthy", ghi789: "unreachable"}

Pool: UPDATE instances SET deploy_status = 'healthy', status = 'ready' WHERE id = 'abc123'
```

### Claim

User requests an agent via dashboard or API. Template resolution and tool provisioning happen here.

```
Dashboard → POST pool/api/claim {templateId: "tpl_1", ownerSignature: "..."}

Pool: SELECT FROM instances WHERE status = 'ready' LIMIT 1 FOR UPDATE SKIP LOCKED → "abc123"
Pool: SELECT FROM agent_templates WHERE id = 'tpl_1' → {agentName, instructions, model, tools}
Pool: reads tools array → [{"id":"email","provisioning":"pool"}, {"id":"sms","provisioning":"user"}]
Pool: splits by provisioning mode:
  - pool-provisioned → ["email"] → pool calls services to create these
  - user-provisioned → ["sms"] → expects credentials in claim body's userConfig

Pool → POST services/provision/abc123/email
  Services: creates AgentMail inbox, injects env var into running instance
  Services: stores {instanceId: "abc123", tool_id: "email", resource_id: "inbox_xyz"} in services DB

Pool → POST services/provision/abc123/sms {userConfig: {telnyxApiKey: "...", telnyxPhone: "..."}}
  Services: validates user-supplied credentials
  Services: injects env vars into running instance (TELNYX_API_KEY, TELNYX_PHONE_NUMBER)
  Services: stores row in services DB with status "user_provided"

Pool → POST services/configure/abc123 {instructions, agentName, model}
  Services: calls running instance's provision endpoint (sets instructions, identity, agent name)
  Services: instance returns {conversationId, inviteUrl}
  Services → {ok, conversationId, inviteUrl}

Pool: UPDATE instances SET status='claimed', owner_id='...', template_id='tpl_1',
      conversation_id='conv_xyz', invite_url='https://convos.org/invite/...', claimed_at=now()
Pool → returns {inviteUrl: "https://convos.org/invite/...", instanceId: "abc123"}
```

### Tick

Pool checks fleet health periodically via a single batch call.

```
Pool: SELECT id FROM instances WHERE status NOT IN ('deleted') → ["abc123", "def456", "ghi789"]

Pool → POST services/status/batch {instanceIds: ["abc123", "def456", "ghi789"]}
  Services: looks up Railway project IDs in services DB
  Services: checks deploy status + pings health endpoints (40 concurrent)
  Services → {abc123: "healthy", def456: "healthy", ghi789: "unreachable"}

Pool: UPDATE instances SET deploy_status = 'healthy' WHERE id IN ('abc123', 'def456')
Pool: UPDATE instances SET deploy_status = 'unreachable' WHERE id = 'ghi789'
Pool: ghi789 has been unreachable > POOL_STUCK_TIMEOUT_MS → UPDATE SET status = 'stuck'
Pool: updates cache
Pool: "I now have 1 idle, need 5" → triggers warm-up
```

### Removal

Pool decides to delete an instance (stuck, expired, etc.).

```
Pool: "abc123 has been stuck for 15 min, deleting"

Pool → DELETE services/destroy/abc123
  Services: looks up all instance_services rows for abc123
  Services: revokes OpenRouter key
  Services: deletes AgentMail inbox
  Services: releases Telnyx number
  Services: releases Bankr wallet
  Services: looks up railway_project_id → projectDelete (kills service, volumes, everything)
  Services: deletes all rows for abc123 from services DB

Pool: DELETE FROM instances WHERE id = 'abc123'
```

### Self-Provision

Running agent requests a new service for itself. Runtime calls services directly — not through pool.

```
Runtime (abc123): "User asked me to send crypto, I don't have a wallet"

Runtime → POST services/provision/abc123/crypto (authenticated with INSTANCE_SERVICES_TOKEN)
  Services: provisions Bankr wallet → 0x1a2b...
  Services: injects BANKR_API_KEY env var into running instance
  Services: stores row in services DB
  Services → {resource_id: "0x1a2b..."}

Runtime: now has crypto capability
```

---

## Databases

Separate Postgres instances. No shared tables, no cross-DB foreign keys. Only shared value is `instance_id` as a correlation key.

### Pool DB

**`instances`**

| Column | Type | Notes |
|--------|------|-------|
| id | text PK | instance ID |
| agent_name | text | set at claim time |
| status | text | starting, ready, claimed, stuck, deleted |
| url | text | public URL |
| deploy_status | text | from services batch status |
| conversation_id | text | set at claim time |
| invite_url | text | set at claim time |
| instructions | text | from template at claim time |
| created_at | timestamptz | |
| claimed_at | timestamptz | |
| template_id | text FK → agent_templates | |
| owner_id | text | inbox ID of the claimer |
| parent_instance | text FK → instances | for cloned instances |
| template_synced_at | timestamptz | last successful sync |

**`agent_templates`**

| Column | Type | Notes |
|--------|------|-------|
| id | text PK | |
| creator_id | text | inbox ID |
| agent_name | text | |
| instructions | text | |
| model | jsonb | `{"default":"...","allow_override":true}` |
| tools | jsonb | `[{"id":"email","provisioning":"pool"}]` |
| visibility | text | private, public |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### Services DB

**`instance_infra`**

| Column | Type | Notes |
|--------|------|-------|
| instance_id | text PK | correlation key with pool |
| railway_project_id | text | the Railway project for this agent |
| railway_service_id | text | |
| railway_environment_id | text | |
| image_tag | text | GHCR tag deployed |
| url | text | public URL (source of truth) |
| instance_services_token | text | auth token for runtime→services calls |
| created_at | timestamptz | |

**`instance_services`**

| Column | Type | Notes |
|--------|------|-------|
| id | text PK | |
| instance_id | text FK → instance_infra | |
| tool_id | text | openrouter, email, sms, crypto, wallet |
| resource_id | text | external resource identifier |
| config | jsonb | tool-specific config |
| status | text | active, destroyed |
| provisioned_at | timestamptz | |

### Rules
- Each has its own `DATABASE_URL`, own migrations, own connection pool
- Cleanup is explicit: pool calls `DELETE services/destroy/:instanceId` before deleting an instance row
- Adding a new service type never requires a schema migration — just a new row with a different `tool_id`
- `railway_project_id` never leaves services DB. Pool doesn't know or care about it.

---

## Environment Variables

### `pool/.env.example`
```sh
# Server
PORT=8080
POOL_API_KEY=
POOL_MIN_IDLE=5
POOL_STUCK_TIMEOUT_MS=900000
TICK_INTERVAL_MS=30000

# Services internal API
SERVICES_URL=http://services.railway.internal:8080
SERVICES_API_KEY=

# Database (pool-owned)
DATABASE_URL=

# Railway metadata (injected by Railway, read-only)
RAILWAY_ENVIRONMENT_NAME=staging
```

### `services/.env.example`
```sh
# Server
PORT=8080
SERVICES_API_KEY=

# Database (services-owned)
DATABASE_URL=

# Railway API (infra layer — team/org-level token, NOT project-scoped)
RAILWAY_API_TOKEN=

# GHCR (single image ref — tag controls which version to deploy)
RAILWAY_RUNTIME_IMAGE=ghcr.io/xmtplabs/convos-runtime:staging  # or :production, :sha-abc1234

# Railway metadata (injected by Railway, read-only)
RAILWAY_ENVIRONMENT_NAME=staging

# OpenRouter (LLM credits)
OPENROUTER_MANAGEMENT_KEY=
OPENROUTER_KEY_LIMIT=20
OPENROUTER_KEY_LIMIT_RESET=monthly

# AgentMail (email)
AGENTMAIL_API_KEY=
AGENTMAIL_DOMAIN=
AGENTMAIL_FALLBACK_INBOX_ID=

# Telnyx (SMS)
TELNYX_API_KEY=

# Bankr (crypto)
BANKR_API_KEY=

# Instance provisioning defaults
XMTP_ENV=dev
OPENCLAW_PRIMARY_MODEL=
```

### `dashboard/.env.example`
```sh
VITE_POOL_API_URL=http://localhost:8080
```

### `runtime/.env.example`
All values below are injected by services via Railway env vars in production. This file is for local dev only.

```sh
# State (baked into Dockerfile defaults)
OPENCLAW_STATE_DIR=/app
CHROMIUM_PATH=/usr/bin/chromium

# Everything below is injected by services at provision time
INSTANCE_SERVICES_TOKEN=               # auth for runtime→services self-provision calls
OPENCLAW_GATEWAY_TOKEN=
SETUP_PASSWORD=
OPENCLAW_PRIMARY_MODEL=
XMTP_ENV=
OPENROUTER_API_KEY=
AGENTMAIL_API_KEY=
AGENTMAIL_INBOX_ID=
BANKR_API_KEY=
TELNYX_API_KEY=
TELNYX_PHONE_NUMBER=
TELNYX_MESSAGING_PROFILE_ID=
PRIVATE_WALLET_KEY=
```

---

## What This Structure Supports Without Refactoring

- **Add / remove / change services** — write a plugin, register a `toolId`. No pool routes, no schema migrations, no dashboard changes
- **Add / remove templates** — template CRUD over a single table. Deleting a template doesn't touch instances
- **Improve the dashboard independently** — `dashboard/` is its own React app consuming pool APIs
- **Scale past 100 agents** — one project per agent, no Railway service limit
- **Network isolation** — every agent is in its own Railway project, no shared `.railway.internal`
- **Fast replenishment** — GHCR pre-built images deploy in ~20-30s instead of 5-10 min builds
- **Inject anything at claim time** — `userConfig` flows from client → pool → instance. Templates declare what to prompt for
- **Billing / credits** — just another plugin + rows in `instance_services`
- **New deployables** — add a directory with its own Dockerfile + CI workflow
- **Swap infra provider** — only services changes. Pool's API is provider-agnostic
- **Runtime self-provisioning** — agents request new capabilities at runtime via services
