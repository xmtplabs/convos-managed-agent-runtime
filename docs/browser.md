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

### Chrome resolution (zero-config)

[`install-deps.sh`](../cli/scripts/install-deps.sh) ensures a Chrome binary is available. Resolution order:

1. **`CHROMIUM_PATH` env** — Docker/Railway set this (e.g. `/usr/bin/chromium`)
2. **Config `browser.executablePath`** — from `openclaw.json`
3. **System Chrome** — scans common paths (`/Applications/Google Chrome.app/...`, `/usr/bin/chromium`, etc.)
4. **Auto-install via `@puppeteer/browsers`** — downloads Chrome for Testing to `$STATE_DIR/browsers/`, reused across restarts

If Chrome is found or installed, the config is patched automatically. No manual setup needed on any OS.

When `CHROMIUM_PATH` is set, [`apply-config.sh`](../cli/scripts/apply-config.sh) also patches `headless=true` and `noSandbox=true`.

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
| Validate config | Check executable, enabled, bind mode, ports | Logs ✅/⚠️/❌ status for each check |

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

- Always use `target: "host"` (headless Chrome has no UI target)
- For `navigate`: always pass `targetUrl` with the full URL
- For `act`: always pass `ref` from a prior `snapshot`
- Always take a `snapshot` before interacting with a page
- Use profile `openclaw`; start via the tool if needed

These instructions are critical for headless mode. Without them, the agent omits required fields and the browser tool returns `"fields are required"`.

## Railway / Docker

The [`Dockerfile`](../Dockerfile) uses `pool-server.js` as the entry point:

- **pool-server** listens on `0.0.0.0:8080` (accepts Railway proxy traffic)
- **gateway** stays on `127.0.0.1:18789` (loopback)
- **browser relay** connects to `ws://127.0.0.1:18789` (passes security check)

Without pool-server, the gateway would bind to `lan` for external access, and the browser relay would hit the `ws://<LAN_IP>` security error.

`CHROMIUM_PATH=/usr/bin/chromium` is set in the Dockerfile. The `apply-config.sh` step patches the config with this path.

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `"pairing required"` | gateway-client device missing `operator.read` scope | Restart gateway — `browser.sh` patches scopes automatically |
| `"tab not found"` | Stale Chrome holding profile lock, new Chrome can't manage tabs | Restart gateway — `browser.sh` kills stale Chrome + removes SingletonLock |
| `"fields are required"` | Agent omitted required browser params (no `target`, no `ref`, no `targetUrl`) | Check TOOLS.md has the headless instructions |
| `ws:// non-loopback security error` | `gateway.bind=lan` + browser relay rejects plaintext to non-loopback | Use pool-server.js (Dockerfile) or set `gateway.bind=loopback` |
| `chrome not found` | Wrong `executablePath` or `CHROMIUM_PATH` not set | Set `CHROMIUM_PATH` env var or fix path in `openclaw.json` |

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
| `cli/scripts/apply-config.sh` | CHROMIUM_PATH → config patching |
| `cli/scripts/gateway.sh` | Calls `browser.sh` before gateway start |
| `openclaw/workspace/TOOLS.md` | Agent instructions (target:host, snapshot, required params) |
| `Dockerfile` | pool-server CMD, CHROMIUM_PATH, Chromium + deps |
| `~/.openclaw/devices/paired.json` | Device pairing state (scopes patched by browser.sh) |
| `~/.openclaw/browser/openclaw/user-data/` | Chrome profile data + SingletonLock |
