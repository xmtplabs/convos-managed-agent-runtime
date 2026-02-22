# QA

## Environments

| Environment | What | How to run |
|-------------|------|------------|
| **GitHub Actions** | Automated on PRs to `main` — spins up gateway + chromium, runs `pnpm cli qa` | Push/open PR |
| **Single Railway instance** | Manual smoke test on a deployed instance (keys pre-set in Railway env vars) | Deploy branch, check logs |
| **Dev pool** | Pool manager (`convos-agents-dev.up.railway.app`) with pre-warmed instances for pool-specific testing | `pnpm pool:dev` or deploy pool service |
| **Fresh Mac** | Full local run from scratch — tests key provisioning, config apply, gateway startup | `pnpm start` (runs full init chain) |

## Prerequisites

Keys are pre-set in `.env` (local/Mac) or Railway env vars (deployed). The `pnpm cli key-provision` step detects existing keys and skips generation — it only creates missing ones.

Required keys: `OPENROUTER_API_KEY`, `AGENTMAIL_API_KEY`, `AGENTMAIL_INBOX_ID`, `BANKR_API_KEY`, `TELNYX_API_KEY`, `TELNYX_PHONE_NUMBER`, `TELNYX_MESSAGING_PROFILE_ID`, `OPENCLAW_GATEWAY_TOKEN`, `PRIVATE_WALLET_KEY`.

## Quick start

```bash
# Local — full init (keys, config, deps, gateway)
pnpm start

# Local — gateway only (keys/config already applied)
pnpm cli gateway run

# Run QA suite
pnpm cli qa            # all suites
pnpm cli qa email      # single suite: email | sms | bankr | browser
```

Health check: `curl http://localhost:18789/__openclaw__/canvas/`

## QA checklist

### Startup

- [ ] `pnpm start` completes without errors
- [ ] Keys: all show `✓ already there` (no unexpected provisioning)
- [ ] Config: gateway port, workspace, plugins.load.paths, browser all patched
- [ ] No `Doctor changes` warning on startup
- [ ] No `⚠️ browser → gateway.bind=lan` warning on Railway
- [ ] Browser pre-flight: profile lock clean, device scopes ok, browser ready
- [ ] Gateway listening, heartbeat + health-monitor started
- [ ] OpenRouter credits check passes (not zero/low)

### Automated (`pnpm cli qa`)

Runs direct CLI commands against the running gateway — no agent sessions. Each suite prints `[PASS]` or `[FAIL]`.

- [ ] **email** — sends via agentmail `send-email.mjs` script
- [ ] **sms** — sends via `telnyx message send`
- [ ] **bankr** — checks USDC balance via `bankr prompt`
- [ ] **convos** — verifies `convos --version` returns
- [ ] **browser** — opens `https://example.com` via `openclaw browser open`

### Agent prompts (manual)

These test the full agent loop (LLM → tool call → response). Gateway must be running.

Use `--session-id "qa-<suite>-$(date +%s)"` for isolated runs, or omit for default session.

**Email**
```bash
openclaw agent -m "Send a random short email to fabri@xmtp.com. Reply: Email sent." --agent main
```

**SMS**
```bash
openclaw agent -m "Send a random short SMS to +16154376139. Reply: SMS sent." --agent main
```

**Bankr**
```bash
openclaw agent -m "Check my USDC balance. Reply: USDC: <balance>." --agent main
```

**Search**
```bash
openclaw agent -m 'Search the current BTC price. Reply: BTC: $X.' --agent main
```

**Browser**
```bash
openclaw agent -m 'go fill the form https://convos-managed-dev.up.railway.app/web-tools/form and submit it, give me the confirmation code' --agent main
```

### Pool-specific (dev pool)

Tested against `convos-agents-dev.up.railway.app`. Requires `POOL_API_KEY`.

- [ ] `GET /healthz` returns `{"ok": true}`
- [ ] `GET /api/pool/status` shows idle instances
- [ ] `POST /api/pool/claim` with `agentName` + `instructions` returns `inviteUrl` + `conversationId`
- [ ] Claimed instance is renamed in Railway dashboard
- [ ] Pool backfills after claim (idle count recovers)
- [ ] `POST /api/pool/claim` with `joinUrl` joins existing conversation
- [ ] `POST /api/pool/reconcile` cleans up orphans without deleting active instances

### Railway single instance

- [ ] Deploy branch, container starts cleanly
- [ ] Logs show no warnings (doctor, browser bind)
- [ ] Browser service ready with correct profile count
- [ ] Agent responds to a convos message end-to-end

### Fresh Mac

- [ ] Clone repo, `pnpm install`
- [ ] Copy `.env` with required keys
- [ ] `pnpm start` provisions missing keys, applies config, installs deps, starts gateway
- [ ] `pnpm cli qa` all suites pass
- [ ] Agent prompt (at least one) returns expected response

## GitHub Actions workflow

The `qa.yml` workflow runs on PRs to `main`:

1. Checks out code, sets up Node 22, installs chromium
2. Writes secrets to `.env`
3. `pnpm install`
4. `pnpm start &` — waits up to 120s for gateway health check, then 15s for browser service
5. `timeout 120 pnpm cli qa` — runs all suites
