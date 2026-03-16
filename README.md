```
    ___  ___  _  _ __   __ ___  ___
   / __|/ _ \| \| |\ \ / // _ \/ __|
  | (__| (_) | .` | \ V /| (_) \__ \
   \___|\___/|_|\_|  \_/  \___/|___/
     🎈 A S S I S T A N T S
```

[![Runtime: PR](https://github.com/xmtplabs/convos-agents/actions/workflows/runtime-pr.yml/badge.svg)](https://github.com/xmtplabs/convos-agents/actions/workflows/runtime-pr.yml)

Each assistant is a pre-warmed container that joins a Convos conversation in seconds. It can browse the web, send email and SMS, manage payments, and more.

<p align="left">
  <a href="https://assistants.convos.org">Launch an assistant</a> · <a href="https://convos.org/app">Get Convos</a>
</p>


## How it works

```
assistants.convos.org          Pool Manager              Railway
┌──────────────┐        ┌──────────────────┐       ┌─────────────┐
│  Pick a      │ claim  │  Pre-warmed      │  run  │  OpenClaw   │
│  template    │───────▶│  instances       │──────▶│  runtime    │
│  or paste    │        │  + providers     │       │  on Convos  │
│  an invite   │        └──────────────────┘       └─────────────┘
└──────────────┘        Railway · OpenRouter         email · SMS
                        AgentMail · Telnyx           payments · web
```

## Repo layout

```
convos-agents/
├── runtime/       # Assistant runtime — OpenClaw gateway, extensions, skills
│   └── scripts/   # Startup, provisioning, health, and cron scripts
├── pool/          # Pool manager — instance lifecycle + provider APIs
├── dashboard/     # Playroom — Next.js app at assistants.convos.org
└── docs/          # Schema, QA, changelog
```

## Runtime

The assistant runtime image. Each instance runs as a container on Railway with an [OpenClaw](https://openclaw.io) gateway, the Convos channel extension, and a set of skills.

**Startup sequence** (`runtime/scripts/`):

| Script | What it does |
|--------|-------------|
| `keys.sh` | Provisions API keys (OpenRouter, AgentMail) and displays env status |
| `apply-config.sh` | Syncs workspace, extensions, and config to the state directory |
| `install-deps.sh` | Installs extension dependencies |
| `gateway.sh` | Starts the OpenClaw gateway with crash recovery and cron seeding |
| `poller.sh` | Background email/SMS poller (no LLM) |
| `pool-server.js` | Health, provision, and status endpoints for pool integration |

**Skills** — what each assistant can do:

| Skill | Capability |
|-------|-----------|
| [`services`](runtime/openclaw/workspace/skills/services/) | Email, SMS, credits, and account info |
| [`bankr`](runtime/openclaw/workspace/skills/bankr/) | Payments, transfers, and swaps |
| [`convos-cli`](runtime/openclaw/workspace/skills/convos-cli/) | Convos client operations |
| [`convos-runtime`](runtime/openclaw/workspace/skills/convos-runtime/) | Version check and runtime upgrade |

See [`runtime/README.md`](runtime/README.md) for environment variables, Docker setup, and CI.

## Pool

Manages pre-warmed assistant instances and all provider integrations. Single Express server, single Postgres database.

```
starting → idle → claiming → claimed
              ↘ crashed
```

Instances are created ahead of time. When a user claims one, the pool provisions a Convos conversation on the instance and backfills the pool automatically.

See [`pool/README.md`](pool/README.md) for API, commands, database schema, and environments.

## Dashboard

The [Convos Playroom](https://assistants.convos.org) — browse the assistant catalog, launch a new assistant, or invite one into an existing conversation.

See [`dashboard/README.md`](dashboard/README.md) for setup, routes, and deployment.

## Quick start

**Invite an assistant via the dashboard** — visit [assistants.convos.org](https://assistants.convos.org), pick a template, and paste your Convos invite link.

**Invite via API** — `POST /api/pool/claim` with an `x-api-key` header:

```json
{
  "agentName": "tokyo-trip-planner",
  "instructions": "You are a helpful trip planner for Tokyo.",
  "joinUrl": "https://convos.org/v2?i=..."
}
```

Returns an `inviteUrl` to share (QR code or deep link). Omit `joinUrl` to create a new conversation.

## Providers

| Provider | Role | Integration |
|----------|------|-------------|
| [OpenRouter](https://openrouter.ai) | LLM inference and web search | [`openrouter.ts`](pool/src/services/providers/openrouter.ts) |
| [Railway](https://railway.com) | Container compute for each assistant | [`railway.ts`](pool/src/services/providers/railway.ts) |
| [AgentMail](https://agentmail.to) | Per-assistant email inbox | [`agentmail.ts`](pool/src/services/providers/agentmail.ts) |
| [Telnyx](https://telnyx.com) | Per-assistant US phone number for SMS | [`telnyx.ts`](pool/src/services/providers/telnyx.ts) |
| [Bankr](https://bankr.bot) | Per-assistant wallet | [`wallet.ts`](pool/src/services/providers/wallet.ts) |
