# Phase 0 — GHCR CI Pipeline

[Back to plan](./plan.md) | [Architecture](./architecture.md) | Next: [Phase 1 — Monorepo Foundation](./phase-1-monorepo.md)

---

## Goal

Ship pre-built runtime images to GitHub Container Registry. This eliminates 5-10 minute per-agent builds and unblocks all later phases that depend on image-based deployment.

## Work

- GitHub Actions workflow: auto-triggered on push to `staging` and `main`
- Build `runtime/Dockerfile`, push to `ghcr.io/xmtplabs/convos-runtime`
- Tags: `:staging` or `:production` (branch-based) + `:sha-<commit>` (rollback/pinning)
- Services reads `AGENT_IMAGE` + `AGENT_IMAGE_TAG` (or defaults from `RAILWAY_ENVIRONMENT_NAME`)
- Optional `AGENT_IMAGE_TAG` override to pin to a specific SHA
- Pool manager Dockerfile is NOT part of this pipeline — it stays deployed on Railway from source

## Validate

- Image builds successfully in CI
- Image pushes to GHCR
- Image can be pulled and run locally

## Notes

- This phase is standalone — no monorepo restructuring needed
- The existing Dockerfile at project root becomes the build target
- After Phase 1 (monorepo), the Dockerfile moves to `runtime/Dockerfile` and the workflow path updates accordingly

## Rolling Updates

New GHCR pushes do NOT auto-update existing agents. New agents get the latest image. For existing agents:
- **Default:** Old agents keep running their current image, naturally cycle out on teardown
- **Manual:** `POST services/redeploy/:instanceId` triggers redeployment on idle agents (available after Phase 3)
- **Future:** Gradual drain-and-replace rollout (not in initial scope)
