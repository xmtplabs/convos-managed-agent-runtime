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
│    ├── skills (agentmail, bankr, telnyx)        │
│    └── webchat control UI                       │
└─────────────────────────────────────────────────┘
```

The `pnpm start` script runs four steps in sequence:

1. **keys.sh** — Displays all env var status. Generates `OPENCLAW_GATEWAY_TOKEN`, `SETUP_PASSWORD`, `PRIVATE_WALLET_KEY` if not set. Provisions OpenRouter keys (via management key) and AgentMail inboxes if needed.
2. **apply-config.sh** — Syncs workspace and extensions from the image to the state dir. Patches `openclaw.json` with port, workspace path, plugin paths, and browser config.
3. **install-deps.sh** — Runs `pnpm install` in each extension directory (convos, web-tools). Links shared deps.
4. **gateway.sh** — Starts `openclaw gateway run` with a restart loop (max 5 rapid crashes in 30s window).

## Directory structure

```
runtime/
├── Dockerfile              # node:22-bookworm + chromium + pnpm
├── package.json            # openclaw + deps
├── openclaw/
│   ├── openclaw.json       # config template (${ENV_VAR} placeholders)
│   ├── extensions/
│   │   ├── convos/         # XMTP messaging channel
│   │   └── web-tools/      # browser automation, landing page, forms
│   └── workspace/
│       ├── IDENTITY.md     # agent identity
│       ├── SOUL.md         # personality / welcome message
│       ├── TOOLS.md        # tool usage guidelines
│       └── skills/         # agentmail, bankr, telnyx-cli, convos-cli
└── scripts/
    ├── entrypoint.sh       # Railway volume setup
    ├── keys.sh             # env var provisioning + display
    ├── apply-config.sh     # sync config to state dir
    ├── install-deps.sh     # extension deps
    ├── gateway.sh          # openclaw gateway with restart loop
    ├── pool-server.js      # pool health/provision endpoints
    ├── qa.sh               # smoke test runner
    └── lib/
        ├── init.sh         # set ROOT, load .env, load paths
        ├── paths.sh        # derive STATE_DIR, WORKSPACE_DIR, etc.
        ├── env-load.sh     # load .env with token preservation
        ├── node-path.sh    # add node_modules to NODE_PATH and PATH
        └── sync-openclaw.sh # rsync workspace + extensions to state dir
```

## Environment variables

All values are injected by the pool manager via Railway env vars at instance creation time. For local dev, use `runtime/.env`.

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENCLAW_PRIMARY_MODEL` | yes | Default LLM model (e.g. `openrouter/anthropic/claude-sonnet-4-6`) |
| `OPENROUTER_API_KEY` | yes | OpenRouter API key for LLM calls |
| `XMTP_ENV` | yes | XMTP network (`dev` or `production`) |
| `OPENCLAW_GATEWAY_TOKEN` | no | Gateway auth token (generated if not set) |
| `SETUP_PASSWORD` | no | Setup UI password (generated if not set) |
| `PRIVATE_WALLET_KEY` | no | Ethereum wallet key (generated if not set) |
| `AGENTMAIL_API_KEY` | no | AgentMail API key (enables email skill) |
| `AGENTMAIL_INBOX_ID` | no | AgentMail inbox (provisioned if API key set) |
| `BANKR_API_KEY` | no | Bankr API key (enables crypto skill) |
| `TELNYX_API_KEY` | no | Telnyx API key (enables SMS skill) |
| `TELNYX_PHONE_NUMBER` | no | Telnyx phone number (provisioned if API key set) |
| `TELNYX_MESSAGING_PROFILE_ID` | no | Telnyx messaging profile |

### Docker / Railway only

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCLAW_STATE_DIR` | `~/.openclaw` | State directory (`/app` in Docker, Railway volume path in production) |
| `CHROMIUM_PATH` | — | Path to Chromium binary (`/usr/bin/chromium` in Docker) |
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

Images are built and pushed by `.github/workflows/build-runtime.yml`:

| Trigger | Tag | Example |
|---------|-----|---------|
| Push to `scaling` | `:scaling` | `ghcr.io/xmtplabs/convos-runtime:scaling` |
| Push to `staging` | `:staging` | `ghcr.io/xmtplabs/convos-runtime:staging` |
| Push to `main` | `:production` | `ghcr.io/xmtplabs/convos-runtime:production` |
| PR | `:pr-N` | `ghcr.io/xmtplabs/convos-runtime:pr-98` |
| All | `:sha-<7chars>` | `ghcr.io/xmtplabs/convos-runtime:sha-b53321d` |

The pool manager pulls the image via `RAILWAY_RUNTIME_IMAGE` env var.

## Pool integration

When deployed by the pool manager, the runtime exposes endpoints via `pool-server.js`:

| Endpoint | Description |
|----------|-------------|
| `GET /pool/health` | Returns `{"ready": true}` when gateway is up |
| `POST /pool/provision` | Sets agent name, instructions, creates conversation |
| `GET /pool/status` | Current instance status |

The pool manager creates a Railway service with the GHCR image, injects env vars, waits for `/pool/health`, then provisions via `/pool/provision` at claim time.

## Gateway restart loop

`gateway.sh` runs `openclaw gateway run` in a loop:
- Clean exit (code 0) → stop
- Crash → restart after 2s
- 5 rapid crashes within 30s → give up

The `OPENCLAW_NO_RESPAWN=1` flag tells OpenClaw to reload config in-process (SIGUSR1) instead of spawning a new process, preventing container restarts on config changes.
