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
                          ├──────────────→ idle
                          │         (provision failed, runtime reset proved clean)
                          ↓
                       crashed
                 (provision failed, reset could not prove clean)
```

State transitions are driven by **Railway webhooks** (push-based, near-real-time):
- `Deployment.deployed` → health-checks the instance, promotes `starting → idle`
- `Deployment.crashed` / `failed` / `oom_killed` → marks unclaimed instances `dead`, claimed instances `crashed`
- `Deployment.slept` → marks instance `sleeping`
- `Deployment.resumed` → health-checks and restores to `idle` or `claimed`

Webhook rules are auto-registered on startup. Instances in `claiming` status are never touched by webhooks (atomic claim in progress). Crashed/dead instances are only marked in the DB — manual cleanup via the dashboard is required.

When `/pool/provision` fails, the pool now calls the runtime's `/convos/reset` endpoint and verifies `/convos/status.reusable` before deciding whether `claiming` can safely return to `idle`. A runtime that still reports residue after reset stays `crashed`.

New instances are created via the admin dashboard or `POST /api/pool/replenish`. Manual recheck via dashboard buttons still works as a fallback.

## Commands

From project root:

| Command | Description |
|--------|-------------|
| `pnpm pool` | Start pool server |
| `pnpm pool:dev` | Start with watch + `pool/.env` |
| `pnpm pool:db:migrate` | Apply pending DB migrations |
| `pnpm pool:test` | Run pool tests |

Or from `pool/`:

| Command | Description |
|--------|-------------|
| `pnpm dev` | Start with watch + `.env` |
| `pnpm start` | Start server |
| `pnpm test` | Run tests |
| `pnpm db:generate` | Generate a migration after editing `schema.ts` |
| `pnpm db:migrate` | Apply pending DB migrations |

## Setup

Requires Node.js 22+ and a [Railway](https://railway.com) Postgres database.

```sh
cp pool/.env.example pool/.env
pnpm install
cd pool && pnpm db:migrate    # creates all tables on a fresh DB
pnpm start
```

## Environment variables

| Variable | Description |
|----------|-------------|
| **Pool manager** | |
| `PORT` | Server port (default `3001`) |
| `POOL_API_KEY` | Shared secret for API auth (Bearer token) and webhook URL secret |
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
| `TELNYX_MESSAGING_PROFILE_ID` | Telnyx messaging profile (used by proxy for SMS send) |

## Database

All state is stored in a single Postgres database with three tables. See [`docs/schema.md`](../docs/schema.md) for the full schema.

### Changing the schema

Migrations are managed by [Drizzle Kit](https://orm.drizzle.team/docs/drizzle-kit-overview). `schema.ts` is the single source of truth.

1. Edit `pool/src/db/schema.ts`
2. Run `pnpm db:generate` — produces a timestamped SQL file in `pool/drizzle/`
3. Commit the migration file alongside the schema change
4. On deploy, migrations run automatically on startup

Never edit the generated SQL files in `pool/drizzle/`. Never bump `drizzle-kit` or `drizzle-orm` without testing.

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

Full API documentation is available at `/admin/api-docs` in the admin dashboard (requires login). The OpenAPI spec is at `/admin/assets/openapi.json`.

## Environments

| Environment | Pool Manager URL | XMTP Network | Source Branch |
|-------------|-----------------|---------------|---------------|
| dev | `convos-agents-dev.up.railway.app` | dev | *(your branch)* |
| staging | `convos-agents-staging.up.railway.app` | dev | `staging` |
| production | `convos-agents.up.railway.app` | production | `main` |
