# Phase 1 — Monorepo Foundation

[Back to plan](./plan.md) | [Architecture](./architecture.md) | Prev: [Phase 0 — GHCR](./phase-0-ghcr.md) | Next: [Phase 2 — TypeScript](./phase-2-typescript.md)

---

## Goal

Restructure the repo into a pnpm workspace with separate packages for pool, services, dashboard, and runtime.

## Work

- Add `pnpm-workspace.yaml` declaring `pool`, `services`, `dashboard`, `runtime`
- Add `turbo.json` with build/dev/lint pipeline
- Add root `tsconfig.base.json` (shared compiler options)
- Root `package.json` becomes workspace-only (no source code, no Dockerfile)
- Move `cli/`, `openclaw/`, root `Dockerfile` into `runtime/` with its own `package.json`
- Strip non-runtime CLI commands from `runtime/cli/`

## Validate

- `pnpm install` from root installs all workspaces
- `pnpm --filter pool dev` starts the pool server
- `pnpm --filter runtime build` builds the runtime
- CI workflow (Phase 0) still builds from `runtime/Dockerfile`

## Notes

- Pool keeps its existing JS files for now — TypeScript conversion is Phase 2
- `services/` and `dashboard/` directories are created as empty placeholders (or minimal scaffolds) to reserve the workspace names
