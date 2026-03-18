# Runtime

Two agent runtimes as peers — **OpenClaw** (Node.js) and **Hermes** (Python) — each with its own Dockerfile, dependencies, and scripts. Shared infrastructure (evals, `.env`, version, changelog) lives at this root level.

**Images:** `ghcr.io/xmtplabs/convos-runtime` (OpenClaw) · `ghcr.io/xmtplabs/convos-runtime-hermes` (Hermes)

## How it works

```
┌─────────────────────────────────────────────────┐
│  runtime container                              │
│                                                 │
│  keys.sh → apply-config.sh → install-deps.sh   │
│       ↓                                         │
│  gateway.sh (restart loop)                      │
│       ↓                                         │
│  openclaw gateway run                           │
│    ├── convos channel (XMTP)                    │
│    ├── web-tools (browser, forms)               │
│    ├── skills (services, bankr)      │
│    └── webchat control UI                       │
└─────────────────────────────────────────────────┘
```

The `pnpm start` script runs four steps in sequence:

1. **keys.sh** — Displays all env var status. Generates `OPENCLAW_GATEWAY_TOKEN` if not set. Provisions OpenRouter keys (via services API or management key) and AgentMail inboxes if needed. Retries 3x on services failure. Fails fast if `OPENROUTER_API_KEY` is missing after provisioning.
2. **apply-config.sh** — Syncs workspace and extensions from the image to the state dir. Merges shared workspace (`runtime/shared/workspace/`) with runtime-specific workspace, then assembles `AGENTS.md` from `AGENTS-base.md` + `agents-extra.md`. Workspace sync keeps local edits and local-only files, copies new image files forward, and tracks the last image baseline in `$OPENCLAW_STATE_DIR/.workspace-base`. It also patches `openclaw.json` with port, workspace path, plugin paths, and browser config.
3. **install-deps.sh** — Runs `pnpm install` in each extension directory (convos, web-tools). Links shared deps.
4. **gateway.sh** — Seeds cron jobs (`crons.sh`), starts the background poller (`poller.sh`), and runs `openclaw gateway run` with a restart loop (max 5 rapid crashes in 30s window).

## Directory structure

```
runtime/
├── .env                    # shared env vars (all runtimes)
├── .env.example            # env var template
├── package.json            # shared version + eval scripts
├── CHANGELOG.md            # shared changelog
├── evals/                  # shared eval suite (see evals/README.md)
├── shared/                 # shared across both runtimes
│   ├── workspace/
│   │   ├── AGENTS-base.md  # shared agent instructions (~80% of AGENTS.md)
│   │   ├── SOUL.md         # personality
│   │   └── skills/         # services, convos-runtime, convos-cli, bankr
│   └── web-tools/          # browser automation, landing page, forms
├── openclaw/               # OpenClaw runtime
│   ├── Dockerfile          # node:22-bookworm + chromium + pnpm
│   ├── package.json        # openclaw deps + runtime scripts
│   ├── openclaw.json       # config template (${ENV_VAR} placeholders)
│   ├── extensions/
│   │   └── convos/         # XMTP messaging channel
│   ├── workspace/
│   │   ├── agents-extra.md # openclaw-specific agent instructions
│   │   ├── HEARTBEAT.md    # heartbeat nudge config
│   │   └── (no skills — all moved to shared)
│   └── scripts/            # keys, gateway, poller, crons, pool-server, etc.
└── hermes/                 # Hermes runtime
    ├── Dockerfile          # python:3.11 + node 22 + hermes-agent
    ├── package.json        # convos-cli dep
    ├── src/                # FastAPI server + XMTP bridge
    ├── workspace/
    │   ├── agents-extra.md # hermes-specific agent instructions
    │   ├── config.yaml     # hermes toolset config
    │   └── CONVOS_PROMPT.md # platform prompt (hermes-only)
    └── scripts/            # entrypoint, apply-config, eval-env, etc.
```

## Shared workspace

`runtime/shared/workspace/` contains files used by both runtimes. Each runtime's `apply-config.sh` copies these into the right place at boot.

### How it works

| File | Purpose | Assembly |
|------|---------|----------|
| `AGENTS-base.md` | Shared agent instructions (~80% of final AGENTS.md) | Concatenated with runtime's `agents-extra.md` to produce AGENTS.md |
| `SOUL.md` | Personality / persona (includes OpenClaw YAML frontmatter, ignored by Hermes) | Copied as-is |
| `skills/` | All skills (services, convos-runtime, convos-cli, bankr) | Copied to runtime's skills directory |

**AGENTS.md assembly:** `cat AGENTS-base.md agents-extra.md > AGENTS.md`. Each runtime keeps an `agents-extra.md` in its own workspace with runtime-specific sections (e.g. Delegation, Memory, Identity for Hermes).

**Where files land at runtime:**

| | OpenClaw | Hermes |
|--|---------|--------|
| AGENTS.md | `$STATE_DIR/workspace/AGENTS.md` | `$ROOT/AGENTS.md` (CWD — Hermes auto-loads from CWD) |
| SOUL.md | `$STATE_DIR/workspace/SOUL.md` | `$HERMES_HOME/SOUL.md` |
| Skills | `$STATE_DIR/workspace/skills/` | `$HERMES_HOME/skills/` |

### Adding new capabilities

- **New shared skill** — add a directory under `runtime/shared/workspace/skills/` with a `SKILL.md`. Both runtimes pick it up automatically. Use `$SKILLS_ROOT` for script paths in SKILL.md.
- **New shared instruction** — edit `AGENTS-base.md` for behavior that applies to both runtimes.
- **Runtime-specific instruction** — edit the runtime's `workspace/agents-extra.md`.
- **New dependency for a skill** — add it to both `hermes/package.json` and `openclaw/package.json`.

## Scripts

All scripts run from `cd runtime`.

| Script | Description |
|--------|-------------|
| `pnpm start` | OpenClaw: full init (keys → apply → install-deps → gateway) |
| `pnpm gateway` | OpenClaw: start the gateway only |
| `pnpm smoke` | OpenClaw: smoke tests (email, sms, convos, browser) |
| `pnpm pool-server` | OpenClaw: pool-managed container entrypoint |
| `pnpm build` | OpenClaw: build Docker image locally |
| `pnpm build:run` | OpenClaw: build and run with .env |
| `pnpm start:hermes` | Hermes: start local dev server |
| `pnpm setup:hermes` | Hermes: first-time local dev setup (clone + deps) |
| `pnpm build:hermes` | Hermes: build Docker image locally |
| `pnpm build:run:hermes` | Hermes: build and run with .env |
| `pnpm evals openclaw [suite]` | Run evals against openclaw (see [evals/README.md](evals/README.md)) |
| `pnpm evals hermes [suite]` | Run evals against hermes |

## Environment variables

All values are injected by the pool manager via Railway env vars at instance creation time. For local dev, use `runtime/.env`.

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENCLAW_PRIMARY_MODEL` | yes | Default LLM model (e.g. `openrouter/anthropic/claude-opus-4-6`) |
| `EVALS_MODEL` | no | Grader/judge model for evals |
| `OPENROUTER_API_KEY` | yes | OpenRouter API key for LLM calls |
| `XMTP_ENV` | yes | XMTP network (`dev` or `production`) |
| `OPENCLAW_GATEWAY_TOKEN` | no | Gateway auth token — used for all internal and pool manager auth (generated if not set) |
| `INSTANCE_ID` | no | Pool instance ID (set by pool manager at creation) |
| `POOL_URL` | no | Pool manager URL — service calls (email, SMS) are proxied through this |
| `POOL_SERVER_PORT` | no | Port of pool-server.js (set by pool-server for gateway) |
| `POSTHOG_API_KEY` | no | PostHog project token — enables usage telemetry (forwarded by pool manager) |
| `POSTHOG_HOST` | no | PostHog ingest URL (default: `https://us.i.posthog.com`) |

### Docker / Railway only

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCLAW_STATE_DIR` | `~/.openclaw` | State directory (`/app` in Docker, Railway volume path in production) |
| `PORT` | `18789` | Gateway port (`8080` in Docker/Railway) |

## Local development

### Run locally (no Docker)

```sh
cd runtime/openclaw
pnpm install
# edit runtime/.env with your keys (shared .env at runtime root)
pnpm start
```

Gateway starts at `http://localhost:18789`. State goes to `~/.openclaw`.

### Run in Docker

```sh
cd runtime/openclaw

# build + run
pnpm build:run

# run without rebuilding (uses existing convos-runtime:local image)
pnpm docker:run
```

Gateway starts at `http://localhost:8080`. State goes to `/app` inside the container.

**Important:** Docker `--env-file` does not strip quotes. Values in `runtime/.env` must be unquoted:

```sh
# correct
OPENROUTER_API_KEY=sk-or-v1-abc123

# wrong (Docker passes literal quotes as part of the value)
OPENROUTER_API_KEY="sk-or-v1-abc123"
```

## CI / GHCR

Images are built by `.github/workflows/runtime-pr.yml` (PRs) and `.github/workflows/runtime-dispatch.yml` (manual).

| Trigger | Tag | Example |
|---------|-----|---------|
| PR touching `runtime/openclaw/**` | `:pending-<sha>` (build), then `:sha-<sha>` + `:pr-N` after QA | `ghcr.io/xmtplabs/convos-runtime:pending-b53321d` |
| Merge to branch | `:<branch>` (dev, staging, production, scaling) | `ghcr.io/xmtplabs/convos-runtime:production` |
| `workflow_dispatch` (manual) | `:<choice>` (dev, staging, production, scaling) | `ghcr.io/xmtplabs/convos-runtime:staging` |

Flow: PR → build `:pending-<sha>` → QA → publish `:sha-<sha>` and `:pr-N`. On merge, image is retagged to the branch (e.g. merge to `main` → `:production`). Railway environments use branch tags (e.g. `:dev`, `:production`); set `RAILWAY_RUNTIME_IMAGE` to override.

## Pool integration

When deployed by the pool manager, the runtime exposes endpoints via `pool-server.js`:

| Endpoint | Description |
|----------|-------------|
| `GET /pool/health` | Returns `{"ready": true, "version": "...", "runtime": "openclaw"|"hermes"}` when gateway is up |
| `POST /pool/provision` | Sets agent name, instructions, creates conversation |
| `GET /pool/status` | Current instance status |
| `POST /pool/self-destruct` | Instance requests own destruction via pool manager (localhost-only) |

The pool manager creates a Railway service with the GHCR image, injects env vars, waits for `/pool/health`, then provisions via `/pool/provision` at claim time.

## Telemetry

Both runtimes emit an `instance_stats` event to PostHog every 60s (direct POST to `/batch/`, no proxy). Only instances with an active conversation emit. Requires `POSTHOG_API_KEY` to be set.

| Property | Type | Description |
|---|---|---|
| `instance_id` | string | Pool instance ID |
| `runtime` | string | `openclaw` or `hermes` |
| `messages_in` | int | Inbound messages since last flush (delta) |
| `messages_out` | int | Outbound messages since last flush (delta) |
| `tools_invoked` | int | Tool calls since last flush (delta, not yet instrumented) |
| `skills_invoked` | int | Skill loads since last flush (delta, not yet instrumented) |
| `group_member_count` | int | Current group member count (gauge) |
| `environment` | string | Pool environment (`dev`, `staging`, `production`) |
| `seconds_since_last_message_in` | int | Staleness signal (-1 if no messages yet) |
| `schema_version` | int | Currently `1` |

Person properties set via `$set`: `agent_name`, `runtime`.

Counters are deltas (reset after each flush). If a flush fails, the deltas are lost — the next flush starts from zero, creating a gap, not a double-count.

## Gateway restart loop

`gateway.sh` runs `openclaw gateway run` in a loop:
- Clean exit (code 0) → stop
- Crash → restart after 2s
- 5 rapid crashes within 30s → give up

The `OPENCLAW_NO_RESPAWN=1` flag tells OpenClaw to reload config in-process (SIGUSR1) instead of spawning a new process, preventing container restarts on config changes.

Sessions live under `OPENCLAW_STATE_DIR`, so gateway restarts reconnect to the existing conversation instead of wiping session history. The main restart-time data loss risk was workspace template overwrite, which `apply-config.sh` now avoids for locally edited workspace files.
