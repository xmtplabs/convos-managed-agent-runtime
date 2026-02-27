# Phase 6 — Template DB, CRUD + Template-Aware Claim

[Back to plan](./plan.md) | [Architecture](./architecture.md) | Prev: [Phase 5 — Dashboard](./phase-5-dashboard.md)

---

## Goal

Add the template system: `agent_templates` table, CRUD endpoints, and template-aware claiming.

## Work

### Pool DB
- Create `agent_templates` table (see [architecture.md](./architecture.md#pool-db) for schema)
- Add template/owner columns to `instances`: `template_id`, `owner_id`

### Template CRUD

New route file `pool/src/routes/templates.ts`:
- `GET /api/pool/templates?visibility=public` — browse store
- `GET /api/pool/templates?creator={inbox_id}` — creator's templates
- `POST /api/pool/templates` — create (private default)
- `PUT /api/pool/templates/:id` — update
- `PATCH /api/pool/templates/:id/visibility` — publish/unpublish
- `DELETE /api/pool/templates/:id` — delete

### Template-aware claim

Extended `POST /api/pool/claim`:
- When `templateId` present: fetch template → check visibility → call services to provision declared tools → configure instance → write `template_id` + `owner_id`
- When absent: existing flow (backward compatible)

Claim sequence with template:
1. Pool picks idle instance (`FOR UPDATE SKIP LOCKED`)
2. Pool reads template → determines needed tools
3. Pool splits tools by provisioning mode (`pool` vs `user`)
4. Pool calls `POST services/provision/:instanceId/:toolId` for each pool-provisioned tool
5. Pool calls `POST services/configure/:instanceId` with instructions, name, model
6. Pool updates instance row with `template_id`, `owner_id`, `conversation_id`, `invite_url`

## Validate

- Template CRUD works (create, read, update, delete, visibility toggle)
- Claiming with `templateId` provisions the right tools
- Claiming without `templateId` still works (backward compatible)
- User-provisioned tools receive `userConfig` from claim body

## Notes

- Templates declare tools as `[{"id":"email","provisioning":"pool"}, {"id":"sms","provisioning":"user"}]`
- `provisioning: "pool"` means pool calls services to create the resource
- `provisioning: "user"` means the claim request must include credentials in `userConfig`
