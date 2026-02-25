# Services

Provider services API — manages Railway infrastructure, per-instance OpenRouter keys, AgentMail inboxes, and Telnyx phone numbers. Pool delegates all provider interactions here via private networking.

## Commands

From project root:

| Command | Description |
|--------|-------------|
| `pnpm services` | Start services server |
| `pnpm services:build` | TypeScript build |
| `pnpm services:dev` | Build + start with watch + `.env` |

Or from `services/`:

| Command | Description |
|--------|-------------|
| `pnpm build` | TypeScript compile |
| `pnpm start` | Start server (from dist/) |
| `pnpm dev` | Start with watch + `.env` |
| `pnpm db:migrate` | Run DB migrations |

## Configuration

Copy `.env.example` to `.env`. See `.env.example` for all required variables.

Key groups:
- **SERVICES_API_KEY** — Bearer token for pool → services auth
- **DATABASE_URL** — Same Postgres as pool
- **RAILWAY_*** — Railway API token, project/environment IDs, runtime image
- **OPENROUTER_MANAGEMENT_KEY** — Creates per-instance keys with spending caps
- **AGENTMAIL_API_KEY** — Creates per-instance inboxes
- **TELNYX_API_KEY** — Provisions per-instance US phone numbers

## API

All routes require Bearer `SERVICES_API_KEY` except `/healthz`.

### Infrastructure

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/healthz` | GET | Health check (no auth) |
| `/create-instance` | POST | Create Railway service + provision tools |
| `/destroy/:instanceId` | DELETE | Destroy all resources for an instance |
| `/redeploy/:instanceId` | POST | Redeploy latest deployment |

### Status

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/status/batch` | POST | Deploy status for all or filtered agent services |

### Tools

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/provision/:instanceId/:toolId` | POST | Provision a single tool |
| `/destroy/:instanceId/:toolId/:resourceId` | DELETE | Destroy a tool resource |

### Configuration

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/configure/:instanceId` | POST | Set env vars on a Railway service |

### Registry

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/registry` | GET | List available tools and provisioning modes |

## Database

Services creates two tables in the shared Postgres (via `migrate()`):

- **instance_infra** — Provider-level infrastructure per instance (Railway service ID, URL, secrets)
- **instance_services** — Per-tool provisioned resources (OpenRouter key hash, AgentMail inbox ID, Telnyx phone number)

## Deployment

Deployed as a separate Railway service in the same project. Pool communicates via Railway private networking (`http://services.railway.internal:3002`).
