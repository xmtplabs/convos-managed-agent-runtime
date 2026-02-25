# Testing — GitHub Actions CI

## Overview

The CI pipeline lives in `.github/workflows/build-runtime.yml`. It has two jobs: **build** and **qa**. Build runs on every push; QA runs only on pull requests.

## Triggers

The workflow only fires when files under `runtime/` change:

- **Push** to `scaling`, `dev`, `staging`, or `main` — builds and pushes the image
- **Pull request** targeting those branches — builds, pushes, then runs QA

Changes outside `runtime/` (e.g. `pool/`, `docs/`, `migration-plan/`) do **not** trigger a build.

## Job 1: Build

1. Checks out the repo
2. Logs in to GHCR (`ghcr.io`) using `GITHUB_TOKEN`
3. Sets up Docker Buildx (layer caching via GitHub Actions cache)
4. Determines image tags:
   - **Branch push:** tag = branch name (`scaling`, `dev`, `staging`) or `production` (for `main`)
   - **Pull request:** tag = `pr-<number>` (avoids invalid `/` characters from `N/merge` ref)
   - **Always:** a second tag `sha-<7-char commit hash>` for pinning/rollback
5. Builds `runtime/Dockerfile` (context = repo root) and pushes both tags to `ghcr.io/xmtplabs/convos-runtime`

### Image tag examples

| Event | Tags pushed |
|-------|-------------|
| Push to `scaling` | `:scaling`, `:sha-abc1234` |
| Push to `main` | `:production`, `:sha-abc1234` |
| PR #42 | `:pr-42`, `:sha-abc1234` |

## Job 2: QA (PRs only)

Runs after build completes (`needs: build`). Timeout: 15 minutes.

### Steps

1. **Pull image** — pulls the `pr-N` tagged image that was just built
2. **Start container** — runs the image with:
   - `node scripts/pool-server.js` as the entrypoint (starts gateway + health/provision endpoints)
   - All required secrets injected as env vars (API keys for OpenRouter, AgentMail, Telnyx, Bankr, etc.)
   - Port 8080 exposed
3. **Health check** — polls `http://localhost:8080/pool/health` every second for up to 120s, waiting for `{"ready":true}`
4. **Wait for browser** — extra 15s pause for the browser service to initialize
5. **Smoke tests** — runs `pnpm qa` inside the container (120s timeout), which executes `runtime/scripts/qa.sh`
6. **Log dump on failure** — if any step fails, dumps full container logs for debugging

### What the smoke tests check

`qa.sh` runs these checks sequentially:

| Test | What it does | Pass condition |
|------|-------------|----------------|
| **email** | Sends an email via AgentMail (`send-email.mjs`) | Output contains "Sent to" |
| **sms** | Sends an SMS via Telnyx CLI | Output contains "queued", "sent", "delivered", or "id" |
| **bankr** | Queries USDC balance via Bankr | Output contains "USD", "balance", or "0x" |
| **convos** | Runs `convos --version` | Output contains "convos-cli" |
| **browser** | Opens a URL via openclaw browser | Output contains "opened", "tab", "target", etc. |

If any test fails, the script exits with code 1 and reports which tests failed.

## Required Secrets

These must be set in the GitHub repo settings (Settings > Secrets and variables > Actions):

| Secret | Used by |
|--------|---------|
| `OPENROUTER_API_KEY` | QA: LLM calls |
| `OPENCLAW_PRIMARY_MODEL` | QA: model selection |
| `AGENTMAIL_API_KEY` | QA: email test |
| `AGENTMAIL_INBOX_ID` | QA: email inbox |
| `BANKR_API_KEY` | QA: bankr test |
| `TELNYX_API_KEY` | QA: SMS test |
| `TELNYX_PHONE_NUMBER` | QA: SMS sender number |
| `TELNYX_MESSAGING_PROFILE_ID` | QA: SMS profile |
| `OPENCLAW_GATEWAY_TOKEN` | QA: gateway auth |
| `PRIVATE_WALLET_KEY` | QA: wallet operations |
| `XMTP_ENV` | QA: XMTP network |

`GITHUB_TOKEN` is provided automatically by GitHub Actions for GHCR auth.

## Coverage

What the CI pipeline covers (and doesn't) across the architecture:

### Runtime

- [x] **Docker image builds** — Dockerfile compiles, all deps install, image pushes to GHCR
- [x] **Gateway starts** — OpenClaw gateway boots and responds to health checks
- [x] **pool-server.js** — Express server starts, `/pool/health` returns `{"ready":true}`
- [x] **Email (AgentMail)** — sends an email via `send-email.mjs` script
- [x] **SMS (Telnyx)** — sends an SMS via Telnyx CLI
- [x] **Crypto (Bankr)** — queries wallet balance via Bankr CLI
- [x] **Convos CLI** — `convos --version` runs (binary installed correctly)
- [x] **Browser** — opens a URL via openclaw browser (Chromium headless works in container)
- [ ] **Convos channel (XMTP)** — not tested (requires persistent identity + network)
- [ ] **Agent conversation flow** — not tested (requires full LLM round-trip with agent session)
- [ ] **Workspace/skills loading** — not directly tested (indirectly validated by gateway startup)

### Pool Manager

- [ ] **Tick loop** — not tested in CI (runs on Railway, talks to Railway API)
- [ ] **Instance creation** — not tested (requires Railway API token + project)
- [ ] **Claiming** — not tested (requires running instances)
- [ ] **Health checks** — not tested (requires deployed instances)
- [ ] **Drain / kill** — not tested (requires running instances)
- [ ] **DB migrations** — not tested in CI (runs on pool manager startup)

### Services (not yet extracted)

- [ ] **Railway project lifecycle** — not tested (currently in pool)
- [ ] **Tool provisioning** — not tested (currently in runtime `keys.sh`)
- [ ] **Batch status** — not tested (planned for Phase 2)

### Infrastructure

- [x] **GHCR push** — image published with correct branch/SHA tags
- [x] **Docker layer caching** — Buildx GHA cache enabled
- [x] **PR isolation** — PR images tagged `pr-N`, don't overwrite branch tags
- [ ] **Production promotion** — `main` push tags as `:production` (tested by workflow logic, not exercised in QA)
- [ ] **Rolling updates** — existing agents are not auto-updated (by design)

## Running locally

To run the same smoke tests locally against a running runtime:

```bash
cd runtime
pnpm qa
```

Gateway must be running first (`pnpm gateway` or `pnpm start`).
