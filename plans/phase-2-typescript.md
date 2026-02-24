# Phase 2 — TypeScript Migration (pool)

[Back to plan](./plan.md) | [Architecture](./architecture.md) | Prev: [Phase 1 — Monorepo](./phase-1-monorepo.md) | Next: [Phase 3 — Services](./phase-3-services.md)

---

## Goal

Convert pool from JavaScript to TypeScript so that the services extraction in Phase 3 starts from a typed codebase.

## Work

- Convert all `pool/src/*.js` → `.ts`, leaf modules first
- Add `@types/express`, `@types/pg` to pool
- Add `tsconfig.json` to pool extending `tsconfig.base.json`
- Build to `dist/`, update pool Dockerfile to run from compiled output

## Validate

- `pnpm --filter pool build` compiles without errors
- Pool starts and passes existing health checks
- All current functionality works (claim, tick, provisioning)

## Notes

- Leaf-first conversion order: `naming.ts` → `cache.ts` → `status.ts` → `services.ts` → `railway.ts` → `provision.ts` → `pool.ts` → `index.ts`
- No logic changes — pure type annotation pass
- Strict mode can be enabled incrementally (start with `strict: false`, tighten later)
