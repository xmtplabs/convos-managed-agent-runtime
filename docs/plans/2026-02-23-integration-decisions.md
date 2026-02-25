# Integration Decisions: Monorepo + Sharding + Portable Instances

**Date:** 2026-02-23
**Status:** Draft

Three plans need to merge into one execution path: the **Monorepo** restructuring (pool/services/dashboard/runtime), **Multi-Project Sharding** (one Railway project per agent + GHCR pre-built images), and **Portable Agent Instances** (template sharing + instance cloning with memory transfer).

These are the decisions that need to be made before implementation.

---

## 1. Who owns Railway project lifecycle?

The monorepo plan puts all Railway interaction in **services**. The sharding plan has the "pool manager" directly creating/deleting Railway projects. With one-project-per-agent, services needs project-level APIs that the current monorepo plan doesn't define.

**Decision:** Does services expose `POST /projects` and `DELETE /projects/:id` alongside the existing per-tool provisioning routes? Or does "create project + configure GHCR + create service" become a single `POST /provision/:instanceId` that services handles internally?

---

## 2. Unified instance schema

Three plans each add different columns:

- **Monorepo:** `instances` table replaces `agent_metadata`, has `railway_service_id`
- **Sharding:** adds `railway_project_id`, drops `source_branch`
- **Portable:** adds `template_id`, `owner_id`, `parent_instance`, `template_synced_at`

**Decision:** The merged `instances` table needs all of: `railway_service_id`, `railway_project_id`, `template_id`, `owner_id`, `parent_instance`, `template_synced_at`. Does `railway_project_id` live in pool DB (since pool needs it for status tracking) or services DB (since services owns Railway interaction)?

---

## 3. Where does `railway_project_id` live?

This is the crux of the pool-services boundary question. Pool needs project IDs for its tick loop (DB-driven agent enumeration). Services needs project IDs to create/destroy Railway resources. Duplicating across both DBs violates the "no shared tables" rule but in reverse.

**Options:**

- Pool DB stores it (pool is source of truth for instances, services is stateless for infra ops)
- Services DB stores it (services owns all Railway concepts, pool asks services for deployment status)
- Both (pool passes project_id to services on each call)

---

## 4. Tick loop boundary

The sharding plan makes the tick loop DB-driven and queries each agent's Railway deployment status individually (~40 concurrent). The monorepo plan says pool never talks to external APIs directly.

**Decision:** Does pool call `GET services/status/:instanceId` for each agent (respecting the boundary but adding HTTP overhead at 500+ agents), or does pool batch-query services with `POST services/status/batch` (new API), or does services expose a dedicated tick/health endpoint?

---

## 5. GHCR CI trigger and tagging

- **Monorepo Phase 3:** manually triggered, `latest` + SHA/semver tags
- **Sharding plan:** on push to staging/main, branch-name + SHA tags

**Decision:** Auto-trigger on push or manual? Tag with branch names (`staging`, `production`) or semver? The sharding plan's branch-based tagging is simpler and handles the staging-to-production promotion naturally.

---

## 6. Phase sequencing

The three plans have interleaved dependencies:

| Monorepo Phase | Sharding Dependency | Portable Dependency |
|---|---|---|
| Phase 0 (workspace) | Prerequisite | Prerequisite |
| Phase 1 (TypeScript) | Prerequisite | Prerequisite |
| Phase 2 (extract services) | Must account for project lifecycle | Must account for template-aware provisioning |
| Phase 3 (GHCR) | **Overlaps entirely** with sharding CI | — |
| Phase 5 (DB migration) | Must include `railway_project_id` | Must include template/owner/parent columns |
| Phase 6 (templates) | — | **Is** the portable plan's template CRUD |
| Phase 7 (sync + clone) | — | **Is** the portable plan's core |

**Decision:** Do you merge Phase 3 with the sharding plan's CI pipeline? Do you do sharding (one-project-per-agent) as part of Phase 2 or as a separate phase between 2 and 3?

---

## 7. Teardown simplification

With one-project-per-agent, teardown is `projectDelete` (kills everything). The monorepo plan has pool calling `DELETE services/destroy/:instanceId` which then cleans up individual resources.

**Decision:** Does `DELETE services/destroy/:instanceId` just call `projectDelete` internally and skip individual resource cleanup? Or does services still clean up external resources (OpenRouter key revocation, AgentMail inbox deletion) before deleting the project — since those aren't Railway-managed?

Likely the latter. Railway project deletion only cleans up Railway resources. OpenRouter keys, AgentMail inboxes, and Telnyx numbers are external and need explicit cleanup.

---

## 8. Template-aware provisioning across the boundary

The portable plan's claim flow: pool reads template, determines tools, provisions each tool, configures instance. The monorepo plan: pool calls services for provisioning. The sharding plan: provisioning also means creating a Railway project.

**Decision:** What's the claim sequence?

1. Pool receives claim with `templateId`
2. Pool resolves template, determines needed tools
3. Pool calls services to create Railway project + deploy image — **or** does this happen before the template is resolved (pre-warmed idle instances)?
4. Pool calls services to provision each tool
5. Pool configures instance with credentials

If idle instances are pre-created (projects already exist), then project creation is separate from claiming. The sharding plan's creation flow applies to pool replenishment, not to claiming. This matches the current architecture.

---

## 9. Services API surface (merged)

The monorepo plan defines:

```
POST   /provision/:instanceId
POST   /provision/:instanceId/:toolId
DELETE /destroy/:instanceId/:toolId/:resourceId
GET    /registry
```

The sharding plan requires:

```
POST   /infra/create-instance       (project + env + GHCR + service + volume)
DELETE /infra/destroy-instance       (projectDelete)
GET    /infra/deploy-status/:instanceId
POST   /infra/redeploy/:instanceId
```

**Decision:** Is infra lifecycle a separate set of routes from tool provisioning, or does `POST /provision/:instanceId` handle both "create the Railway project" and "provision the OpenRouter key"?

---

## 10. Pre-warming vs. on-demand with one-project-per-agent

Today, idle instances are pre-warmed in a pool. With one-project-per-agent, each idle instance costs a Railway project. At `POOL_MIN_IDLE=5`, that's 5 projects sitting idle.

**Decision:** Is pre-warming still viable with per-project agents? Railway likely charges per project or has project limits. The sharding plan says "creating an idle agent now means more API calls but each completes in seconds since there's no build." Is the pool concept still necessary, or does GHCR make on-demand provisioning fast enough to drop the pool entirely?

---

## Summary

The three biggest gating decisions:

1. **Where does Railway project lifecycle live** in the pool-services boundary (affects Phase 2 design)
2. **Phase sequencing** — whether sharding is merged into or separate from the monorepo phases (affects execution order)
3. **Whether pre-warming is still the model** with per-project agents, or whether GHCR speed makes on-demand viable (affects the fundamental pool architecture)
