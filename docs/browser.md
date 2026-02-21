# Browser

The agent uses a managed headless Chrome instance (profile `openclaw`) for web interactions — filling forms, booking tables, checking availability. The browser tool is part of OpenClaw core; this repo handles config, startup cleanup, and agent instructions.

## Architecture

```
Agent (LLM)
  ↓ browser tool call
Gateway (port 18789)
  ↓ WebSocket (browser relay, port 18792)
Chrome headless (CDP, port 18800)
```

The browser relay connects to the gateway via `ws://127.0.0.1:18789`. The gateway must bind to `loopback` — if it binds to `lan`, the relay constructs `ws://<LAN_IP>:<port>` and the core rejects it as a plaintext-to-non-loopback security error.

## Config

[`openclaw/openclaw.json`](../openclaw/openclaw.json) — browser block:

| Key | Value | Why |
|---|---|---|
| `enabled` | `true` | Enables the browser tool |
| `headless` | `true` | Always headless (local and Railway) |
| `noSandbox` | `true` | Required for Docker/containers |
| `attachOnly` | `false` | Gateway launches Chrome (not attach to existing) |
| `executablePath` | `/Applications/Google Chrome.app/...` | macOS default; overridden by `CHROMIUM_PATH` on Docker |
| `remoteCdpTimeoutMs` | `5000` | CDP connection timeout. Do not lower. |
| `remoteCdpHandshakeTimeoutMs` | `8000` | CDP handshake timeout. Do not lower — prevents Chrome cold-start races. |
| `defaultProfile` | `openclaw` | Profile name for user-data dir and CDP port |
| `profiles.openclaw.cdpPort` | `18800` | Chrome DevTools Protocol port |

**Config vs agent instructions:** The config controls how Chrome launches (headless, sandbox, ports). The agent instructions in TOOLS.md control what the LLM passes per tool call (`target: "host"`, `targetUrl`, `ref`). These are two separate layers — the config cannot replace the agent instructions.

## Chrome resolution

[`install-deps.sh`](../cli/scripts/install-deps.sh) ensures a Chrome binary is available. Resolution order:

1. **`CHROMIUM_PATH` env** — Docker/Railway set this (e.g. `/usr/bin/chromium`)
2. **Config `browser.executablePath`** — from `openclaw.json`
3. **System Chrome** — scans common paths (`/Applications/Google Chrome.app/...`, `/usr/bin/chromium`, etc.)

If Chrome is found, the config is patched automatically.

When `CHROMIUM_PATH` is set, [`apply-config.sh`](../cli/scripts/apply-config.sh) also patches `headless=true` and `noSandbox=true`.

### Chromium references across the repo

Every file that references Chrome/Chromium and why:

| File | What | Why |
|---|---|---|
| `Dockerfile` (line 10) | `apt install chromium` + font/lib deps | Bakes Chromium into Docker image — no runtime download |
| `Dockerfile` (line 38) | `ENV CHROMIUM_PATH=/usr/bin/chromium` | Points install-deps.sh to the baked-in binary |
| `pool/src/keys.js` (line 35) | `CHROMIUM_PATH: "/usr/bin/chromium"` | Pool server passes env to spawned gateway instances |
| `cli/scripts/apply-config.sh` (line 34-39) | Patches config when `CHROMIUM_PATH` is set | Sets `executablePath`, `headless=true`, `noSandbox=true` for Docker |
| `cli/scripts/install-deps.sh` (step 3) | Chrome resolution + config patching | env → config → system paths |
| `cli/scripts/browser.sh` | Validates `executablePath` from config | Startup pre-flight logs chrome path and readiness |
| `.env.example` (line 27) | `CHROMIUM_PATH=` | Documents the env var for local dev |
| `.github/workflows/qa.yml` (line 12, 30) | `CHROMIUM_PATH` + `apt install chromium` | CI needs Chrome for browser QA suite |
| `openclaw/openclaw.json` | `browser.executablePath` | macOS default path; patched at runtime by apply-config or install-deps |
| `README.md` (line 67) | Documents `CHROMIUM_PATH` env | User-facing docs |
| `docs/changelog.md` (line 79-80) | Historical changelog entries | Records when Chromium support was added |

## Startup self-heal (`browser.sh`)

[`cli/scripts/browser.sh`](../cli/scripts/browser.sh) runs before every gateway start (called by `gateway.sh`). Also available standalone: `pnpm cli browser`.

What it does:

| Step | What | Why |
|---|---|---|
| Kill stale Chrome | `pkill -9 -f "user-data-dir=$STATE_DIR/browser"` | Port-based kill misses renderers, GPU, network helpers |
| Kill CDP/relay ports | `lsof -ti tcp:18800` / `tcp:18792` | Catch anything else holding the ports |
| Remove SingletonLock | Delete `SingletonLock` + `SingletonSocket` | Dead Chrome leaves dangling symlinks that block new instances |
| Clear pending pairing | `rm devices/pending.json` | Stale scope-upgrade requests cause "pairing required" errors |
| Patch device scopes | Add `operator.read` to gateway-client | Older pairings miss this scope; browser relay needs it for Chrome control |
| Validate config | Check executable, enabled, bind mode, ports | Logs status for each check |

Output:

```
  🌐 Browser pre-flight
  ═══════════════════
  ✅ processes     → no stale Chrome
  ✅ profile lock  → clean
  ✅ device scopes → ok
  🌐 chrome       → /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
  🖥  headless     → true
  🔒 sandbox      → off
  ✅ browser      → ready (headless=true, cdp=:18800, relay=:18792)
```

## Agent instructions

[`openclaw/workspace/TOOLS.md`](../openclaw/workspace/TOOLS.md) — injected into the agent's system prompt:

| Instruction | What it does | Why it can't be in config |
|---|---|---|
| `target: "host"` | LLM passes this per tool call to use headless Chrome | Config controls Chrome launch, not per-call params |
| `targetUrl` for navigate | LLM must include the full URL | Per-call parameter (the URL to visit) |
| `ref` from snapshot | LLM references elements by ref from a prior snapshot | Workflow guidance for the LLM |
| snapshot before interact | LLM must snapshot the page before acting on it | Workflow guidance for the LLM |
| profile `openclaw` | LLM uses the correct Chrome profile | Could default from config, but explicit is safer |

These instructions are critical for headless mode. Without them, the agent omits required fields and the browser tool returns `"fields are required"`.

## Railway / Docker

The [`Dockerfile`](../Dockerfile) uses `pool-server.js` as the entry point:

- **pool-server** listens on `0.0.0.0:8080` (accepts Railway proxy traffic)
- **gateway** stays on `127.0.0.1:18789` (loopback)
- **browser relay** connects to `ws://127.0.0.1:18789` (passes security check)

Without pool-server, the gateway would bind to `lan` for external access, and the browser relay would hit the `ws://<LAN_IP>` security error.

Chromium is baked into the Docker image (`apt install chromium`) with `CHROMIUM_PATH=/usr/bin/chromium`. The `apply-config.sh` step patches the config with this path and forces `headless=true` + `noSandbox=true`. The `pool/src/keys.js` also passes `CHROMIUM_PATH` to spawned instances.

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `"pairing required"` | gateway-client device missing `operator.read` scope | Restart gateway — `browser.sh` patches scopes automatically |
| `"tab not found"` | Stale Chrome holding profile lock, new Chrome can't manage tabs | Restart gateway — `browser.sh` kills stale Chrome + removes SingletonLock |
| `"fields are required"` | Agent omitted required browser params (no `target`, no `ref`, no `targetUrl`) | Check TOOLS.md has the headless instructions |
| `ws:// non-loopback security error` | `gateway.bind=lan` + browser relay rejects plaintext to non-loopback | Use pool-server.js (Dockerfile) or set `gateway.bind=loopback` |
| `chrome not found` | Wrong `executablePath` or `CHROMIUM_PATH` not set | Install Chrome/Chromium, set `CHROMIUM_PATH`, or fix path in `openclaw.json` |

## Ports

| Port | Service | Configurable via |
|---|---|---|
| 18789 | Gateway (WebSocket + HTTP) | `gateway.port` / `PORT` env |
| 18792 | Browser relay | `OPENCLAW_RELAY_PORT` env |
| 18800 | Chrome CDP | `profiles.openclaw.cdpPort` / `OPENCLAW_CDP_PORT` env |

## Files

| File | Role |
|---|---|
| `openclaw/openclaw.json` | Browser config (timeouts, headless, profile, executable path) |
| `cli/scripts/browser.sh` | Startup self-heal (kill stale Chrome, fix scopes, validate) |
| `cli/scripts/install-deps.sh` | Chrome resolution + config patching |
| `cli/scripts/apply-config.sh` | `CHROMIUM_PATH` → config patching (headless, noSandbox, executablePath) |
| `cli/scripts/gateway.sh` | Calls `browser.sh` before gateway start |
| `openclaw/workspace/TOOLS.md` | Agent instructions (target:host, snapshot, required params) |
| `Dockerfile` | pool-server CMD, `CHROMIUM_PATH`, Chromium + deps baked in |
| `pool/src/keys.js` | Passes `CHROMIUM_PATH` env to spawned gateway instances |
| `.env.example` | Documents `CHROMIUM_PATH` for local dev |
| `.github/workflows/qa.yml` | CI: installs Chromium + sets `CHROMIUM_PATH` |
| `~/.openclaw/devices/paired.json` | Device pairing state (scopes patched by browser.sh) |
| `~/.openclaw/browser/openclaw/user-data/` | Chrome profile data + SingletonLock |
