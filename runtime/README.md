# Runtime

The agent runtime is a pre-built Docker image containing the OpenClaw gateway, extensions (convos channel, web-tools), workspace (skills, identity), and all CLI dependencies. Published to GHCR and deployed by the pool manager on Railway.


**Image:** `ghcr.io/xmtplabs/convos-runtime`

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
2. **apply-config.sh** — Syncs workspace and extensions from the image to the state dir. Patches `openclaw.json` with port, workspace path, plugin paths, and browser config.
3. **install-deps.sh** — Runs `pnpm install` in each extension directory (convos, web-tools). Links shared deps.
4. **gateway.sh** — Starts `openclaw gateway run` with a restart loop (max 5 rapid crashes in 30s window).

## Directory structure

```
├── Dockerfile              # node:22-bookworm + chromium + pnpm
├── package.json            # openclaw + deps
├── openclaw/
│   ├── openclaw.json       # config template (${ENV_VAR} placeholders)
│   ├── extensions/
│   │   ├── convos/         # XMTP messaging channel
│   │   └── web-tools/      # browser automation, landing page, forms
│   └── workspace/
│       ├── AGENTS.md       # agent instructions
│       ├── IDENTITY.md     # agent identity
│       ├── SOUL.md         # personality / welcome message
│       ├── TOOLS.md        # tool usage guidelines
│       ├── USER.md         # user context
│       ├── HEARTBEAT.md    # heartbeat checklist
│       ├── BOOTSTRAP.md    # first-run ritual
│       └── skills/
│           ├── bankr/      # crypto (transfers, swaps)
│           ├── convos-cli  # Convos CLI commands
│           └── services/   # email, SMS, credits, info
└── scripts/
    ├── entrypoint.sh       # Railway volume setup
    ├── keys.sh             # env var provisioning + display
    ├── apply-config.sh     # sync config to state dir
    ├── install-deps.sh     # extension deps
    ├── gateway.sh          # openclaw gateway with restart loop
    ├── pool-server.js      # pool health/provision endpoints
    ├── smoke.sh            # smoke tests (proxy when POOL_URL set, direct otherwise)
```

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm start` | Full init: keys → apply → install-deps → gateway |
| `pnpm keys` | Generate gateway token; create/reuse OpenRouter key; write .env |
| `pnpm apply` | Sync workspace/skills/extensions and copy config template to state dir |
| `pnpm install-deps` | Install extension and skill deps in OPENCLAW_STATE_DIR |
| `pnpm gateway` | Start the gateway |
| `pnpm smoke` | Smoke tests (email, sms, convos, browser) — uses proxy when POOL_URL is set |
| `pnpm evals` | Run both eval suites (see [evals/README.md](evals/README.md)) |
| `pnpm evals:prompt` | Prompt eval only (parallel) |
| `pnpm evals:convos` | Convos lifecycle eval only (sequential) |
| `pnpm pool-server` | Pool-managed container entrypoint (spawns gateway, serves /pool/* API) |
| `pnpm build` | Build Docker image locally |
| `pnpm build:run` | Build and run with .env from repo root |

## Environment variables

All values are injected by the pool manager via Railway env vars at instance creation time. For local dev, use `runtime/.env`.

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENCLAW_PRIMARY_MODEL` | yes | Default LLM model (e.g. `openrouter/anthropic/claude-sonnet-4-6`) |
| `OPENROUTER_API_KEY` | yes | OpenRouter API key for LLM calls |
| `XMTP_ENV` | yes | XMTP network (`dev` or `production`) |
| `OPENCLAW_GATEWAY_TOKEN` | no | Gateway auth token — used for all internal and pool manager auth (generated if not set) |
| `INSTANCE_ID` | no | Pool instance ID (set by pool manager at creation) |
| `POOL_URL` | no | Pool manager URL — service calls (email, SMS) are proxied through this |
| `POOL_SERVER_PORT` | no | Port of pool-server.js (set by pool-server for gateway) |

### Docker / Railway only

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCLAW_STATE_DIR` | `~/.openclaw` | State directory (`/app` in Docker, Railway volume path in production) |
| `PORT` | `18789` | Gateway port (`8080` in Docker/Railway) |

## Local development

### Run locally (no Docker)

```sh
cd runtime
pnpm install
# edit .env with your keys
pnpm start
```

Gateway starts at `http://localhost:18789`. State goes to `~/.openclaw`.

### Run in Docker

```sh
cd runtime

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
| PR touching `runtime/**` | `:pending-<sha>` (build), then `:sha-<sha>` + `:pr-N` after QA | `ghcr.io/xmtplabs/convos-runtime:pending-b53321d` |
| Merge to branch | `:<branch>` (dev, staging, production, scaling) | `ghcr.io/xmtplabs/convos-runtime:production` |
| `workflow_dispatch` (manual) | `:<choice>` (dev, staging, production, scaling) | `ghcr.io/xmtplabs/convos-runtime:staging` |

Flow: PR → build `:pending-<sha>` → QA → publish `:sha-<sha>` and `:pr-N`. On merge, image is retagged to the branch (e.g. merge to `main` → `:production`). Railway environments use branch tags (e.g. `:dev`, `:production`); set `RAILWAY_RUNTIME_IMAGE` to override.

## Pool integration

When deployed by the pool manager, the runtime exposes endpoints via `pool-server.js`:

| Endpoint | Description |
|----------|-------------|
| `GET /pool/health` | Returns `{"ready": true}` when gateway is up |
| `POST /pool/provision` | Sets agent name, instructions, creates conversation |
| `GET /pool/status` | Current instance status |
| `POST /pool/self-destruct` | Instance requests own destruction via pool manager (localhost-only) |

The pool manager creates a Railway service with the GHCR image, injects env vars, waits for `/pool/health`, then provisions via `/pool/provision` at claim time.

## Gateway restart loop

`gateway.sh` runs `openclaw gateway run` in a loop:
- Clean exit (code 0) → stop
- Crash → restart after 2s
- 5 rapid crashes within 30s → give up

The `OPENCLAW_NO_RESPAWN=1` flag tells OpenClaw to reload config in-process (SIGUSR1) instead of spawning a new process, preventing container restarts on config changes.
