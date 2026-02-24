# Phase 3 — Dashboard (React + Vite + TypeScript)

[Back to plan](./plan.md) | [Architecture](./architecture.md) | Prev: [Phase 2 — Services](./phase-2-services.md) | Next: [Phase 4 — Templates](./phase-4-templates.md)

---

## Goal

Build the real product dashboard as a React + TypeScript SPA, consuming the full API including templates. Not a migration of the current inline HTML — a fresh build against the real APIs.

## Work

### TypeScript setup
- Add `tsconfig.base.json` at repo root with shared compiler options
- Add `tsconfig.json` to `pool/`, `services/`, `dashboard/` extending the base
- Convert `pool/src/` from `.js` → `.ts` (incremental, start with new files)
- All new code in `services/` and `dashboard/` is TypeScript from day one

### Dashboard
- Scaffold `dashboard/` with Vite + React + TypeScript
- Built against the real API: pool counts, agent list, claim with templates, template store
- Pool exposes API-only routes (strip inline HTML from `index.ts`)
- Dashboard consumes:
  - `GET /api/pool/counts` — pool statistics
  - `GET /api/pool/agents` — agent list
  - `POST /api/pool/claim` — claim with template support
  - Template CRUD endpoints from Phase 4
- Pool either serves dashboard `dist/` as static files, or dashboard deploys separately

## Validate

- Dashboard renders pool counts and agent list
- Claiming works through the UI (with and without templates)
- Template store (browse, create, edit, publish) works through the UI
- Pool's inline HTML routes are removed

## Notes

- By building the dashboard before templates, we have the UI ready to consume template APIs as soon as Phase 4 lands
- The dashboard is a pure consumer of pool APIs — it has no backend logic
