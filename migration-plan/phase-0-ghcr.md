# Phase 0 — GHCR CI Pipeline

[Back to plan](./plan.md) | [Architecture](./architecture.md) | Next: [Phase 1 — DB Migration](./phase-1-db-migration.md)

---

## Goal

Ship pre-built runtime images to GitHub Container Registry. This eliminates 5-10 minute per-agent builds and unblocks all later phases that depend on image-based deployment.

## Status: Complete (PR #98)

### Done

- **CI workflow** (`.github/workflows/build-runtime.yml`): triggered on push to `scaling`, `dev`, `staging`, `main` — only when `runtime/` changes
- **QA job** runs on PRs: pulls the just-built image, starts with `pool-server.js`, runs smoke tests
- **Dockerfile** moved to `runtime/Dockerfile`, builds from repo root context
- **Image tags**: `:scaling` / `:staging` / `:production` (branch-based) + `:sha-<commit>` (rollback/pinning) + `:pr-N` (PRs)
- **Pool manager** (`pool/src/railway.js`) deploys from pre-built GHCR image
  - Env var: `RAILWAY_RUNTIME_IMAGE` (defaults to `ghcr.io/xmtplabs/convos-runtime:scaling`)
  - Removed: `serviceConnect` + `serviceDisconnect` mutations
  - Added: `serviceInstanceUpdate` with `source.image` field
- **Pool Dockerfile** (`pool/Dockerfile`) uses relative paths, Railway root directory set to `pool/`
- **Auto-migration** — pool manager runs `migrate()` on startup (creates `agent_metadata` table if missing)
- **Simplified env vars** — dropped `INSTANCE_*` prefix. Pool manager reads env vars directly (`OPENCLAW_PRIMARY_MODEL`, `AGENTMAIL_API_KEY`, etc.) and passes them to runtime instances. Single source of truth.
- **Local Docker testing** verified — `pnpm build:run` and `pnpm docker:run` both work
- **Runtime restructured** into `runtime/` subdirectory (was split across root + `cli/`)
- **gateway.sh** fixed — process cleanup was killing its own parent shell via `pgrep` (now walks ancestor chain)
- **Docker env passthrough** fixed — `--env-file` now points to `runtime/.env`
- **keys.sh** now displays all config env vars
- **Documentation** — `docs/runtime.md` (new), `docs/pool.md` (updated)

## Env Vars

The pool manager reads:

```sh
# Pre-built runtime image (pool manager env)
RAILWAY_RUNTIME_IMAGE=ghcr.io/xmtplabs/convos-runtime:scaling
```

This replaces the old `RAILWAY_SOURCE_REPO` + `RAILWAY_SOURCE_BRANCH` approach. The pool no longer connects/disconnects repos — it just tells Railway to pull and run the image.

Agent keys are set directly on the pool manager (no `INSTANCE_*` prefix):

```sh
OPENCLAW_PRIMARY_MODEL=openrouter/anthropic/claude-sonnet-4-6
XMTP_ENV=dev
AGENTMAIL_API_KEY=am_...
BANKR_API_KEY=bk_...
TELNYX_API_KEY=KEY...
```

> **Note:** In the end-state architecture, this moves to the `services` layer. For now it lives in the pool manager since services hasn't been extracted yet.

## What Changed From the Original Plan

| Original plan | Actual |
|---|---|
| CI triggers on `staging` and `main` only | Added `scaling` and `dev` branches; path filter on `runtime/` |
| Env var: `AGENT_IMAGE` + `AGENT_IMAGE_TAG` | Simplified to single `RAILWAY_RUNTIME_IMAGE` (full image ref including tag) |
| `INSTANCE_*` prefix for agent env vars | Dropped — pool reads vars directly, same names everywhere |
| "Phase is standalone — no restructuring needed" | Restructured `cli/` → `runtime/` in same PR (was already in progress on `scaling` branch) |
| Dockerfile at project root | Moved to `runtime/Dockerfile`, build context is repo root |
| Pool manager reads services for image config | Pool reads `RAILWAY_RUNTIME_IMAGE` directly (services doesn't exist yet) |
| Separate QA workflow | Merged into `build-runtime.yml` as dependent job |

## Bugs Fixed Along the Way

1. **gateway.sh fratricide** — `pgrep -f "gateway\.sh"` matched the parent `sh -c "...sh scripts/gateway.sh"` process (PID 17). The script only excluded `$$` but not ancestors. Fix: walk the ancestor chain and skip all of them.
2. **Docker env passthrough** — `build:run` did `cd .. && docker run --env-file .env` which read the project root `.env` instead of `runtime/.env`. Keys like `OPENCLAW_PRIMARY_MODEL` were missing inside the container.
3. **Missing env var display** — `keys.sh` didn't show `AGENTMAIL_API_KEY`, `TELNYX_API_KEY`, `OPENCLAW_PRIMARY_MODEL`, `XMTP_ENV`, or `TELNYX_MESSAGING_PROFILE_ID` status during provisioning.
4. **QA health check timeout** — Container ran `pnpm start` (gateway only) but health check polled `/pool/health` which only exists via `pool-server.js`. Fix: start QA container with `node scripts/pool-server.js`.
5. **Invalid Docker tag** — `GITHUB_REF_NAME` on PRs is `N/merge` (slash invalid in tags). Fix: use `pr-N` format.
6. **Pool Dockerfile build context** — `.dockerignore` excludes `pool/`, breaking `COPY pool/src`. Fix: set Railway root directory to `pool/`, use relative paths in Dockerfile.
7. **Missing DB table** — Pool manager crashed on first deploy (`agent_metadata` does not exist). Fix: auto-run idempotent migration on startup.

## Rolling Updates

New GHCR pushes do NOT auto-update existing agents. New agents get the latest image. For existing agents:
- **Default:** Old agents keep running their current image, naturally cycle out on teardown
- **Manual:** `POST services/redeploy/:instanceId` triggers redeployment on idle agents (available after Phase 3)
- **Future:** Gradual drain-and-replace rollout (not in initial scope)
