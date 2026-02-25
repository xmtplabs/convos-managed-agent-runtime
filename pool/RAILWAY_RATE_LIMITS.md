# Railway API Rate Limit Issue

## Problem

The pool manager's tick loop runs every 30s and makes **1 + N per-service API calls** per tick for domain resolution. Each environment runs its own tick loop, and all share one Railway account.

- Pro tier limit: **10,000 calls/day**
- Rate limits are **per account**, not per token — separate tokens don't help

### Current call volume

| Instances | Envs | Calls/tick/env | Ticks/day (30s) | Calls/day |
|---|---|---|---|---|
| 63 | 4 | 1 + ~16 avg | 2,880 | ~193,000 |
| 100 | 4 | 1 + 25 avg | 2,880 | ~299,520 |
| 1,000 | 4 | 1 + 250 avg | 2,880 | ~2,890,000 |

Rate-limited within ~1-2 hours at any scale.

The `enrich-instances.js` script compounds this: **3 calls per instance** (domain + vars + image) per run.

| Instances | Enrich calls/run |
|---|---|
| 63 | 190 |
| 100 | 301 |
| 1,000 | 3,001 |

## Phase 1: Batch API calls (immediate)

**Batch the `listProjectServices()` GQL query** to return domains and images in a single call, eliminating per-service `getServiceDomain()` and `getServiceImage()` calls.

| Area | Before | After |
|---|---|---|
| Tick loop | 1 + N calls/tick | 1 call/tick |
| Enrich script | 1 + (N x 3) calls/run | 1 + (≤N x 1) calls/run |

Tick budget after batching (1 call/tick/env):

| Instances | Envs | Tick interval | Calls/day | vs 10K limit |
|---|---|---|---|---|
| any | 4 | 30s | 11,520 | over |
| any | 4 | 45s | 7,680 | 23% headroom |
| any | 4 | 60s | 5,760 | 42% headroom |

Tick cost is now **independent of instance count**. Enrich is the remaining per-instance cost:

| Instances | Enrich calls/run (batched) | Tick (60s) + 1 enrich | vs 10K |
|---|---|---|---|
| 63 | 64 | 5,824 | 42% headroom |
| 100 | 101 | 5,861 | 41% headroom |
| 1,000 | 1,001 | 6,761 | 32% headroom |

## Phase 2: Rely on Railway health checks + webhooks (scales to 1,000+)

The tick loop currently does its own HTTP health checks against every instance. This is redundant — Railway has built-in configurable health checks per service. If Railway's health checks are configured properly, the deploy/service status already reflects container health (SUCCESS, CRASHED, etc.).

| Tick responsibility | Currently | Better |
|---|---|---|
| Deploy status tracking | Poll via `listProjectServices()` | Railway webhooks (zero calls) |
| Health checks | Our own HTTP calls per instance | Railway's built-in health checks — status already in API |
| Replenishment | Counted from DB after health checks | Triggered by webhook or low-frequency poll |

**Remove the tick loop entirely.** Replace with:

1. **Configure Railway health checks** on each service — Railway tracks health status, no API calls from us
2. **Railway webhooks** for deploy/health status changes — pushes events to us, zero polling
3. **Low-frequency fallback poll** (every 5-10 min) — single `listProjectServices()` call as safety net, reads health + deploy status from the batched query

Budget without the tick loop:

| Instances | Create (50/day) | Destroy (50/day) | Enrich (1 run) | Fallback poll (5min) | Total | vs 10K |
|---|---|---|---|---|---|---|
| 63 | 250 | 100 | 64 | 1,152 | 1,566 | 84% free |
| 100 | 250 | 100 | 101 | 1,152 | 1,603 | 84% free |
| 1,000 | 250 | 100 | 1,001 | 1,152 | 2,503 | 75% free |

The remaining unbatchable call is `getServiceVariables()` (1 per instance). Caching vars in DB at provision time eliminates enrich entirely, leaving only create/destroy + fallback poll (~1,500/day regardless of scale).
