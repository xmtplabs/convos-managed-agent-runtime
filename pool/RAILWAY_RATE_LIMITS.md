# Railway API Rate Limit Issue

## Problem

The pool manager's tick loop runs every 30s and makes **1 + N per-service API calls** per tick for domain resolution. Each environment runs its own tick loop, and all share one Railway account.

- Pro tier limit: **10,000 calls/hour**
- Rate limits are **per account**, not per token — separate tokens don't help

### Current call volume

| Instances | Envs | Calls/tick/env | Ticks/hour (30s) | Calls/hour |
|---|---|---|---|---|
| 63 | 4 | 1 + ~16 avg | 120 | ~8,160 |
| 100 | 4 | 1 + 25 avg | 120 | ~12,480 |
| 1,000 | 4 | 1 + 250 avg | 120 | ~120,480 |

At 63 instances we're at 82% of the hourly limit from the tick alone — any spike or extra calls tips us over. At 100+ instances we're already over.

## Phase 1: Batch API calls (immediate)

**Batch the `listProjectServices()` GQL query** to return domains and images in a single call, eliminating per-service `getServiceDomain()` and `getServiceImage()` calls.

| Area | Before | After |
|---|---|---|
| Tick loop | 1 + N calls/tick | 1 call/tick |

Tick budget after batching (1 call/tick/env):

| Instances | Envs | Tick interval | Calls/hour | vs 10K limit |
|---|---|---|---|---|
| any | 4 | 30s | 480 | 95% free |
| any | 4 | 60s | 240 | 98% free |

Tick cost is now **independent of instance count**.

## Phase 2: Webhooks (optional)

Phase 1 already frees 95% of the rate limit budget. Phase 2 barely improves throughput (~1,420 vs ~1,360 instances/hour). The real benefit of webhooks is **latency** — instant deploy status updates instead of waiting up to 30s for the next tick poll. Only worth doing if faster instance readiness matters.

### Max instances per hour (10K limit)

| Architecture | Max instances/hour | Latency |
|---|---|---|
| Old (1+N calls/tick) | ~63 (already at 82%) | 30s poll |
| Phase 1: Batched tick | ~1,360 | 30s poll |
| Phase 2: Webhooks | ~1,420 | instant |
