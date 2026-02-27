# Convos agents

OpenClaw gateway + Convos (XMTP) channel plugin. Pre-warmed agent instances are provisioned via a pool; users claim an agent and it's live in seconds.

See `docs/` for architecture, QA, changelog, and workarounds.

## Repo structure

```
convos-agents/
├── runtime/       # Agent runtime image (OpenClaw + config + extensions + skills)
├── pool/          # Pool manager + provider services (Express API + Postgres)
├── dashboard/     # Template site — Next.js app at assistants.convos.org
└── docs/          # Schema, QA, changelog, convos extension docs
```

## Architecture

```mermaid
flowchart LR
  subgraph runtime["runtime"]
    R1[OpenClaw gateway]
    R2[convos extension]
    R3[workspace + skills]
    R1 --> R2 --> R3
  end
  subgraph pool["pool (unified)"]
    P1[Pool manager]
    P2[Idle instances]
    P3[Claim → provision]
    P4[Railway provider]
    P5[OpenRouter provider]
    P6[AgentMail provider]
    P7[Telnyx provider]
    P1 --> P2 --> P3
    P1 --> P4 & P5 & P6 & P7
  end
  pool --> runtime
  runtime -.-> P5
  runtime -.-> P6
  runtime -.-> P7
```

Pool is a single unified service that manages instance lifecycle and all provider interactions (Railway infrastructure, OpenRouter key lifecycle, AgentMail inbox provisioning, Telnyx phone numbers). Everything runs in one process with a single Postgres database.

## Components

### Runtime (`runtime/`)

The agent runtime image — OpenClaw gateway + config, workspace, extensions, and skills. Each agent instance runs as a container on Railway.

See [`runtime/README.md`](runtime/README.md) for scripts, OpenClaw layout, and environment setup.

### Pool (`pool/`)

Pool manager that keeps pre-warmed instances on Railway. Handles claim, provision, replenish, drain, and reconcile operations. Includes provider services (Railway, OpenRouter, AgentMail, Telnyx) and a dashboard UI.

See [`pool/README.md`](pool/README.md) for commands, API, configuration, and environments.

## Pool

The **pool manager** (`pool/`) keeps a set of pre-warmed OpenClaw instances on Railway. When a user claims an agent, the manager picks an idle instance and provisions it (create or join conversation, write instructions).

```mermaid
flowchart LR
  A[starting] --> B[idle/ready]
  B --> C[claimed]
```

- **starting** → container building, gateway starting, XMTP identity created.
- **idle/ready** → instance reports `ready` at `/pool/health`, available for claim.
- **claimed** → manager calls `/pool/provision` (or `/convos/conversation` / `/convos/join`), instance is bound to a conversation.

### Admin dashboard

Password-protected at `/admin` on each pool environment. Authenticates with `POOL_API_KEY` via session cookie.

- View instance counts (ready, starting, claimed, crashed) with filter pills
- Launch/join agents directly from the dashboard
- Kill running instances, dismiss crashed ones, replenish or drain the pool
- QR code modal with invite URL for claimed agents
- Environment switcher across dev/staging/production

### Pool commands

| Command | Description |
|--------|-------------|
| `pnpm pool` | Start pool server |
| `pnpm pool:dev` | Start with watch + `pool/.env` |
| `pnpm pool:db:migrate` | Run DB migrations |
| `pnpm pool:test` | Run pool tests |

Configure via `pool/.env` (see `pool/.env.example`). Example with all instance vars (use placeholders for secrets):

```bash
# Pool
POOL_API_KEY=test
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@postgres.railway.internal:5432/railway

# Railway
RAILWAY_PROJECT_ID=
RAILWAY_ENVIRONMENT_ID=
RAILWAY_API_TOKEN=your-railway-api-token

# OpenRouter (pool creates per-instance keys from this)
OPENROUTER_MANAGEMENT_KEY=sk-or-v1-...

# Agent keys (passed to runtime instances)
OPENCLAW_PRIMARY_MODEL=openrouter/anthropic/claude-sonnet-4-6
XMTP_ENV=dev
AGENTMAIL_API_KEY=am_...
AGENTMAIL_DOMAIN=mail.convos.org
BANKR_API_KEY=bk_...
TELNYX_API_KEY=KEY...
TELNYX_PHONE_NUMBER=+14193792549
TELNYX_MESSAGING_PROFILE_ID=40019c66-c84a-459f-8553-0ef16775fb29
```

### Pool API

Authenticated endpoints require Bearer `POOL_API_KEY` header.

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /api/pool/counts` | No | Idle / starting / claimed / crashed counts |
| `GET /api/pool/agents` | No | List all instances by status (claimed, crashed, idle, starting) |
| `GET /api/pool/info` | No | Environment, branch, model, Railway IDs |
| `GET /api/pool/templates` | No | Agent template catalog |
| `GET /api/pool/templates/:slug` | No | Single template by slug |
| `GET /api/prompts/:pageId` | No | Fetch agent prompt from Notion (cached 1h) |
| `POST /api/pool/claim` | Yes | Claim idle instance; `agentName` and `instructions` are optional, `joinUrl` joins existing convo |
| `POST /api/pool/replenish` | Yes | Add N instances (max 20) |
| `POST /api/pool/drain` | Yes | Remove N idle instances (max 20) |
| `POST /api/pool/reconcile` | Yes | Trigger a tick (sync DB with Railway) |
| `DELETE /api/pool/instances/:id` | Yes | Kill a running instance |
| `DELETE /api/pool/crashed/:id` | Yes | Dismiss a crashed instance |
| `GET /admin` | Session | Admin dashboard (login with `POOL_API_KEY`) |

Environments: **dev** (`convos-agents-dev.up.railway.app`), **staging** (`convos-agents-staging.up.railway.app`), **production** (`convos-agents-production.up.railway.app`). See [`pool/README.md`](pool/README.md).

---

## Template site (dashboard)

Next.js app deployed to Vercel at `assistants.convos.org`. Provides the public-facing experience for browsing and launching agents.

- Browse agent catalog with category filters and skill tags
- Template detail pages with OG image generation and QR codes
- Join flow with guided steps for connecting via XMTP
- Proxies pool API calls through Next.js API routes

See `dashboard/README.md` for setup and development.

---

## Runtime (OpenClaw)

The **runtime** is the OpenClaw gateway plus this repo's config, workspace, extensions, and skills. `pnpm cli apply` syncs `openclaw/` into `~/.openclaw/` (or `OPENCLAW_STATE_DIR`).

### Layout

```
openclaw/
├── openclaw.json          # Config template (env vars substituted at load)
├── workspace/             # → ~/.openclaw/workspace
│   ├── AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, HEARTBEAT.md, BOOT.md, USER.md
│   └── skills/
│       ├── agentmail/     # Email (Agentmail API)
│       ├── telnyx-cli/    # SMS (Telnyx)
│       └── bankr/         # Payments (Bankr)
└── extensions/
    ├── convos/            # XMTP channel: /convos/join, /convos/conversation, setup
    │   ├── index.ts, openclaw.plugin.json, package.json
    │   └── src/           # channel, accounts, sdk-client, outbound, …
    └── web-tools/         # /web-tools/form, /web-tools/agents (convos APIs)
```

When `OPENCLAW_STATE_DIR` is set (e.g. in Docker), `apply` patches `agents.defaults.workspace` to `$STATE_DIR/workspace` so extensions and skills resolve correctly.

### Convos extension

- Registers the Convos channel with OpenClaw; one identity per conversation.
- **Create:** `POST /convos/conversation` with `{ name, env, instructions? }` → new XMTP identity + conversation + invite URL.
- **Join:** `POST /convos/join` with invite URL → join existing conversation.
- **Status:** `GET /convos/status` → `ready` when identity and stream are up.

Pool manager uses these endpoints to provision claimed instances. Full API, config, and layout: **`docs/convos-extension.md`**.

---

## Providers

| Provider | Role |
|----------|------|
| **OpenRouter** | LLM models + search. Per-agent keys with spending caps. |
| **Railway** | Compute. Each agent runs as a container. |
| **Agentmail** | Email. Per-agent inbox for calendar invites and transactional email. |
| **Telnyx** | SMS. Per-agent US number and messaging profile. |
| **Bankr** | Crypto payments. Per-agent wallet. |
