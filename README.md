# Convos agents

OpenClaw gateway + Convos (XMTP) channel plugin. Single agent, managed config. Pre-warmed instances are provisioned via a pool; users claim an agent and it’s live in seconds.

See `docs/` for design, QA, changelog, pool details, **convos extension** (`docs/convos-extension.md`), and workarounds.

## Repo structure

```
pool/          Pool manager — Express API + admin dashboard on Railway
dashboard/     Template site — Next.js app at assistants.convos.org
runtime/       Agent runtime — Docker image (OpenClaw gateway + workspace + extensions)
docs/          Design docs, QA, changelog, convos extension docs
```

---

## High-level flow

```mermaid
flowchart LR
  subgraph tooling["tooling"]
    T1[CLI: init / apply / key-provision]
    T2[QA: email, sms, bankr, search, browser]
  end
  subgraph runtime["runtime"]
    R1[OpenClaw gateway]
    R2[convos extension]
    R3[workspace + skills]
    R1 --> R2 --> R3
  end
  subgraph pool["pool"]
    P1[Pool manager]
    P2[Idle instances]
    P3[Claim → provision]
    P1 --> P2 --> P3
  end
  subgraph providers["providers"]
    V1[OpenRouter]
    V2[Agentmail / Telnyx / Bankr]
    V3[Railway]
  end
  tooling --> runtime
  pool --> runtime
  runtime --> providers
```

---

## Tooling (CLI)

Run with: `pnpm cli <command>`. Help: `pnpm cli help`.

| Command | Description |
|--------|-------------|
| `check` | Log root, workspace, state dir, config and openclaw paths |
| `key-provision` | Generate OPENCLAW_GATEWAY_TOKEN, SETUP_PASSWORD, WALLET_PRIVATE_KEY; create/reuse OpenRouter key; write .env |
| `apply` | Sync workspace/skills/extensions and copy config template to state dir |
| `install-deps` | Install extension and skill deps in OPENCLAW_STATE_DIR |
| `gateway run` | Start the gateway |
| `init` | key-provision (if missing) → apply → install-deps → gateway run |
| `reset <target>` | Reset state. Targets: `sessions`, `chrome`, `convos` |
| `qa [suite]` | QA smoke test. Suites: `email`, `sms`, `bankr`, `search`, `browser`, `all` (default) |

**Quick start:** Copy `.env.example` to `.env`, set any keys you have, then `pnpm cli init`.

### Environment

Key env vars (see `.env.example` for full list):

- **Model:** `OPENCLAW_PRIMARY_MODEL` (e.g. `openrouter/openai/gpt-5.1-codex-mini`)
- **OpenRouter:** `OPENROUTER_API_KEY` or `OPENROUTER_MANAGEMENT_KEY`
- **XMTP:** `XMTP_ENV` (`dev` | `production`)
- **Skills:** `AGENTMAIL_API_KEY`, `AGENTMAIL_DOMAIN` (custom inbox domain, e.g. `mail.convos.org`), `BANKR_API_KEY`, `TELNYX_API_KEY`
- **State:** `OPENCLAW_STATE_DIR` (default `~/.openclaw`; Docker often uses `/app`)
- **Browser:** `CHROMIUM_PATH` (Docker: `/usr/bin/chromium`)

`key-provision` fills in `OPENCLAW_GATEWAY_TOKEN`, `SETUP_PASSWORD`, and optional `AGENTMAIL_INBOX_ID`, `TELNYX_PHONE_NUMBER`, etc. `POOL_API_KEY` and `SETUP_PASSWORD` are optional for pool/convos HTTP auth; when unset, those endpoints allow unauthenticated access.

---

## Pool

The **pool manager** (`pool/`) keeps a set of pre-warmed OpenClaw instances on Railway. When a user claims an agent, the manager picks an idle instance and provisions it (create or join conversation, write instructions).

```mermaid
flowchart LR
  A[starting] --> B[idle/ready]
  B --> C[claimed]
```

- **starting** → container building, gateway starting, XMTP identity created.
- **idle/ready** → instance reports `ready` at `/convos/status`, available for claim.
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
POOL_MIN_IDLE=1
POOL_API_KEY=test
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@postgres.railway.internal:5432/railway

# Railway
RAILWAY_PROJECT_ID=c8090f69-bfd3-4955-a1d1-fe9af4c7c45a
RAILWAY_ENVIRONMENT_ID=3e887007-21f1-40d5-bf0b-89a3fb71f511
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
| `POST /api/pool/self-destruct` | Token | Instance requests its own destruction (per-instance gateway token auth) |
| `DELETE /api/pool/instances/:id` | Yes | Kill a running instance |
| `DELETE /api/pool/crashed/:id` | Yes | Dismiss a crashed instance |
| `GET /admin` | Session | Admin dashboard (login with `POOL_API_KEY`) |

Environments: **dev** (`convos-agents-dev.up.railway.app`), **staging** (`convos-agents-staging.up.railway.app`), **production** (`convos-agents-production.up.railway.app`). See `docs/pool.md`.

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

The **runtime** is the OpenClaw gateway plus this repo’s config, workspace, extensions, and skills. `pnpm cli apply` syncs `openclaw/` into `~/.openclaw/` (or `OPENCLAW_STATE_DIR`).

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
| **OpenRouter** | Models (e.g. Claude, GPT) + Perplexity search. One key per agent on provision; spending caps; dashboard per key. |
| **Railway** | Compute. Each agent runs as a container (ephemeral fs, local Chromium, scoped env). |
| **Agentmail** | Email. Per-agent inbox (`convos-<hex>@agentmail.to`) for calendar invites and transactional email. |
| **Telnyx** | SMS. Per-agent US number and messaging profile; `telnyx-cli` skill for send/receive. |
| **Bankr** | Crypto payments. Per-agent wallet; API key in env. |

OpenRouter keys are created at provision (or via `key-provision` locally). Agentmail inbox and Telnyx number are created during `key-provision` when the corresponding API keys are set.
