# Phase 6 — Dashboard (React + Vite)

[Back to plan](./plan.md) | [Architecture](./architecture.md) | Prev: [Phase 5 — Templates](./phase-5-templates.md)

---

## Goal

Build the real product dashboard as a React SPA, consuming the full API including templates. Not a migration of the current inline HTML — a fresh build against the real APIs.

## Work

- Scaffold `dashboard/` with Vite + React + TypeScript
- Built against the real API: pool counts, agent list, claim with templates, template store
- Pool exposes API-only routes (strip inline HTML from `index.ts`)
- Dashboard consumes:
  - `GET /api/pool/counts` — pool statistics
  - `GET /api/pool/agents` — agent list
  - `POST /api/pool/claim` — claim with template support
  - Template CRUD endpoints from Phase 5
- Pool either serves dashboard `dist/` as static files, or dashboard deploys separately

## Validate

- Dashboard renders pool counts and agent list
- Claiming works through the UI (with and without templates)
- Template store (browse, create, edit, publish) works through the UI
- Pool's inline HTML routes are removed

## Notes

- By building the dashboard last, we avoid migrating the current UI and then having to update it again when templates land
- The dashboard is a pure consumer of pool APIs — it has no backend logic
