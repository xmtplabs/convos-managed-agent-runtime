# Phase 0 — GHCR CI Pipeline

## Status: Complete (PR #98)

Pre-built runtime images on GHCR. Eliminates 5-10 min per-agent builds.

## After Merge — Update on Railway

1. Pool manager root directory → set to `pool/`
2. Remove all `INSTANCE_*` env vars — keys use their original names now (`OPENCLAW_PRIMARY_MODEL`, `AGENTMAIL_API_KEY`, etc.)
3. Set `RAILWAY_RUNTIME_IMAGE=ghcr.io/xmtplabs/convos-runtime:pr-98` (then update to `:dev` after merge)

## What Shipped

- **CI workflow** (`.github/workflows/build-runtime.yml`): push to `scaling`/`dev`/`staging`/`main`, path-filtered to `runtime/`
- **QA on PRs**: pulls image, starts `pool-server.js`, runs smoke tests (email, SMS, bankr, convos, browser)
- **Image tags**: `:branch` + `:sha-<commit>` + `:pr-N`
- **Pool deploys from GHCR** — `serviceInstanceUpdate` with `source.image`, no more repo connect/disconnect
- **Pool Dockerfile** — relative paths, Railway root = `pool/`
- **Auto DB migration** on startup
- **Dropped `INSTANCE_*` prefix** — single source of truth for env vars
- **Runtime restructured** into `runtime/` (was split across root + `cli/`)
- **gateway.sh** fixed (process cleanup fratricide)
- **Docker env passthrough** fixed (reads `runtime/.env`)

## Rolling Updates

New GHCR pushes do NOT auto-update existing agents. New agents get the latest image. Old agents cycle out on teardown.
