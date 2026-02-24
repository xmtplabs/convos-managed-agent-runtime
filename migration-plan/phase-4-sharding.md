# Phase 4 — Railway Sharding (one-project-per-agent)

[Back to plan](./plan.md) | [Architecture](./architecture.md) | Prev: [Phase 3 — Services](./phase-3-services.md) | Next: [Phase 5 — Dashboard](./phase-5-dashboard.md)

---

## Goal

Switch from deploying all agents into a single shared Railway project to one-project-per-agent. Services extraction is already done (Phase 3) — this phase only changes the Railway topology.

## Work

### Services changes
- `create-instance` now: `projectCreate` → environment setup → GHCR credentials → `serviceCreate` from image → env vars → volume → provision tools
- `destroy/:instanceId` now: external resource cleanup → `projectDelete` (deletes the whole project)
- Store `railway_project_id` per instance in `instance_infra`

### Backfill migration
- Set `railway_project_id` on existing `instance_infra` rows from the current shared project ID
- Existing agents in the old single project continue working — no migration needed for them

## Validate

- New agents get their own Railway project
- Destroying an agent deletes the entire project
- Existing agents in the shared project still work
- Backfill migration runs cleanly on existing data
- **One-project-per-agent is live after this phase**

## Notes

- **Railway API token must be team/org-scoped** (not project-scoped) to create new projects — verify token scope during implementation
- Concurrency limit: ~8 parallel agent creations to stay within Railway's 50 RPS rate limit (Pro plan). Each agent creation takes ~5-6 sequential API calls
- This is a small, focused change on top of the services extraction — the blast radius is limited to `create-instance` and `destroy`
