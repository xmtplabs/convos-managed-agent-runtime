# Telemetry Strategy: Privacy-Preserving Usage Analytics

**Date:** 2026-03-17
**Status:** Draft
**Goal:** Understand actual usage patterns of assistants without accessing message content.

## Problem

The pool manager has rich infrastructure observability (Datadog — instance lifecycle, provisioning, webhooks) but zero product usage insight. We don't know: are people engaging with their agents? Do conversations go quiet after day 1? Which tools get used? How much does each instance cost relative to its engagement?

## Constraints

- **Privacy-first:** Counts only. No message content, no PII, no sentiment analysis. Messages are E2E encrypted via XMTP — the telemetry layer never sees them.
- **Scale target:** 10,000 concurrent instances.
- **No new secrets on instances:** Instances must not hold analytics API keys.
- **Datadog stays for infra:** Product analytics goes to PostHog (already used for app analytics).

## Architecture

Two pipelines, one Cloudflare Worker, PostHog as the analytics backend.

### Pipeline 1: Usage Stats (instance-push, every 60s)

```
  ┌─────────────┐   POST /stats    ┌──────────────────┐   POST /capture   ┌─────────┐
  │  Runtime     │ ──────────────►  │  CF Worker        │ ────────────────► │ PostHog │
  │  x10,000     │  id+token+counts │  (stats-ingest)   │  batched events  │         │
  │              │                  │  validates auth    │                  │         │
  └─────────────┘                  └──────────────────┘                   └─────────┘
```

Each runtime accumulates counters in memory. Every 60s, it POSTs a JSON stats snapshot to the Cloudflare Worker. Auth uses the existing `instanceId + gatewayToken` pattern (same as self-destruct, self-upgrade, credits). On shutdown, the runtime flushes one final POST (best-effort — Railway's SIGTERM window is limited, so the final flush may be lost).

**Only instances with an active conversation emit stats.** Idle/starting instances have nothing to report. This means actual volume scales with claimed instances, not total instances.

### Pipeline 2: Credits (Worker cron, every 15min)

```
  ┌─────────────┐   listKeys()     ┌──────────────────┐   POST /capture   ┌─────────┐
  │  OpenRouter  │ ◄────────────── │  CF Worker (cron) │ ────────────────► │ PostHog │
  │  API         │  paginated       │                   │  spend events    │         │
  └─────────────┘                  └──────────────────┘                   └─────────┘
```

A cron-triggered Worker sweeps OpenRouter's management API for per-key usage, computes spend deltas (using Cloudflare KV to track last-seen values), and emits per-instance credit events to PostHog.

### Why a Cloudflare Worker

- 10k instances at 60s = ~167 req/sec. Workers handle this trivially; the pool manager shouldn't.
- Stateless, auto-scales, free tier covers millions of requests/month.
- Holds PostHog and OpenRouter API keys as secrets; instances never see them.
- Decoupled from pool manager availability.

### Why PostHog (not Datadog)

Datadog answers "is the system healthy?" PostHog answers "are users engaging?" Building retention curves, cohort analysis, and feature adoption funnels in Datadog requires fighting the tool. PostHog does this natively. We already use PostHog for app analytics — same project, same dashboards.

Datadog stays for infrastructure: pool health, instance lifecycle, Railway webhooks, provider latencies.

## Events Schema

### Pipeline 1: `instance_stats` (every 60s per instance)

Runtime sends (no `agent_name` — Worker enriches):
```json
{
  "schema_version": 1,
  "instance_id": "abc123",
  "gateway_token": "...",
  "runtime": "hermes",
  "messages_in": 7,
  "messages_out": 5,
  "tools_invoked": 3,
  "skills_invoked": 1,
  "group_member_count": 4,
  "seconds_since_last_message_in": 42
}
```

Worker enriches and forwards to PostHog as:
```json
{
  "event": "instance_stats",
  "distinct_id": "instance:abc123",
  "properties": {
    "instance_id": "abc123",
    "runtime": "hermes",
    "messages_in": 7,
    "messages_out": 5,
    "tools_invoked": 3,
    "skills_invoked": 1,
    "group_member_count": 4,
    "is_active": true,
    "seconds_since_last_message_in": 42,
    "$set": {
      "agent_name": "Bankr",
      "runtime": "hermes"
    }
  }
}
```

**Design decisions:**
- Counters are **deltas since last flush**, not cumulative totals. PostHog sums them over time windows. Avoids overflow and makes shutdown-flush correct.
- `messages_in` / `messages_out` split lets you distinguish "agent monologuing" from "active conversation."
- Reactions count as messages (not a separate counter). Per-type breakdown (`_by_type` map) can be added later without changing the pipeline.
- `group_member_count` is a gauge (current value), not a delta.
- `seconds_since_last_message_in` is a staleness signal. High staleness on an emitting instance = dead conversation.
- `is_active` is always `true` in emitted events (only instances with an active conversation emit). Included for explicitness and to future-proof if idle emission is added later.
- The runtime does **not** send `agent_name`. The Worker enriches it from the pool DB's `instances` table and sets it via `$set` on the PostHog event.
- `tools_invoked` and `skills_invoked` are flat totals. Per-tool/skill breakdown deferred until we have a specific question that needs it.

### Pipeline 2: `instance_credits` (every 15min per instance)

```json
{
  "event": "instance_credits",
  "distinct_id": "instance:{instanceId}",
  "properties": {
    "instance_id": "abc123",
    "credits_usage_total": 4.72,
    "credits_limit": 20.00,
    "credits_remaining": 15.28,
    "credits_spend_delta": 0.38
  }
}
```

**Design decisions:**
- `credits_spend_delta` is the spend since the last sweep. Computed by the Worker using Cloudflare KV to store last-seen `usage` per key hash.
- PostHog sums deltas over any period — per day, per week, per instance, across all instances.
- `credits_usage_total` is the cumulative snapshot from OpenRouter, included for sanity-checking.

## Cloudflare Worker Design

**Single Worker, two entry points:**

1. **`POST /stats`** — validates auth, enriches with `agent_name`, forwards to PostHog.
2. **Cron trigger (every 15min)** — sweeps OpenRouter keys, computes deltas, forwards to PostHog.

### Auth and token caching

Worker connects to pool Postgres via Cloudflare Hyperdrive (connection pooler). Auth query: `SELECT agent_name FROM instances i JOIN instance_infra ii ON i.id = ii.instance_id WHERE ii.instance_id = $1 AND ii.gateway_token = $2`.

At 167 req/sec, hitting Postgres on every request is too much. The Worker caches validated tokens in **Cloudflare KV** with a 5-minute TTL. Cache key: `auth:{instanceId}`, value: `{agentName, validatedAt}`. On cache hit, skip the DB query. On cache miss, query Postgres and write to KV.

This reduces DB queries to ~10k every 5 minutes (one per unique instance per TTL window) = ~33/sec average, which is comfortable.

### Database access

The Worker needs a **read-only Postgres role** scoped to `instances` and `instance_infra` tables. It only reads `instance_id`, `gateway_token`, `agent_name`, and `runtime_type`. It does not need access to `payments`, `phone_number_pool`, `instance_services` (except for the credits cron — see below), or any write operations.

For the credits cron, the Worker also reads `instance_services` where `tool_id = 'openrouter'` to map key hashes to instance IDs via `resource_id`.

### PostHog forwarding

CF Workers are request-scoped — no cross-request buffering. Both pipelines use PostHog's `POST /batch/` endpoint (the only server-side ingestion endpoint). Pipeline 1 sends a single-item batch per request. Pipeline 2 collects all credit events during the sweep and sends them in one batch call.

PostHog `/batch/` body format (validated against SDK source):
```json
{
  "api_key": "phc_...",
  "batch": [{ "distinct_id": "...", "event": "...", "properties": {...} }],
  "sent_at": "2026-03-18T00:00:00.000Z"
}
```

At 167 req/sec for Pipeline 1, this is well within PostHog's ingestion capacity.

### Worker error handling

- **PostHog unreachable:** Worker returns 202 to the runtime (accepted but not delivered). The stats tick is lost — acceptable for analytics.
- **Postgres unreachable:** Worker returns 503. Runtime silently retries next tick.
- **Cron sweep failure:** If the credits sweep fails mid-way, it resumes from the last successfully processed page on the next cron trigger (pagination offset stored in KV).
- **Monitoring:** Worker errors are logged to Cloudflare's built-in logging. A Datadog synthetic check can ping the Worker's health endpoint to alert on prolonged outages.

### Credits sweep: OpenRouter key-to-instance mapping

The cron reads `instance_services` to build a `keyHash -> instanceId` map:
```sql
SELECT instance_id, resource_id AS key_hash
FROM instance_services
WHERE tool_id = 'openrouter' AND status = 'active'
```

It then paginates through OpenRouter's `listKeys()` API, matching each key's `hash` to an `instanceId`. For each matched key, it reads the last-seen usage from KV (`stats-credits:{keyHash}`), computes the delta, emits the PostHog event, and writes the new usage back to KV.

At 10k keys with an assumed page size of 100, this is ~100 sequential API calls. If OpenRouter rate-limits this, the sweep can be throttled (100ms delay between pages = ~10s total) or split across multiple cron invocations using KV-stored pagination offsets.

### Worker secrets

- `POSTHOG_API_KEY`
- `OPENROUTER_MANAGEMENT_KEY`
- `DATABASE_URL` (pool Postgres read-only role, via Hyperdrive)

### KV namespaces

- `stats-auth` — token validation cache (TTL: 5min)
- `stats-credits` — last-seen OpenRouter usage per key hash (no TTL, overwritten each sweep)

## Runtime Instrumentation

### Stats accumulator (per-runtime)

A simple module implemented independently in each runtime (new files to be created):

- **Hermes:** `runtime/hermes/src/stats.py`
- **OpenClaw:** `runtime/openclaw/extensions/convos/src/stats.ts`

Interface:
```
StatsAccumulator:
  increment(metric)              — messages_in, messages_out, tools_invoked, skills_invoked
  set(metric, value)             — group_member_count, seconds_since_last_message_in
  flush() -> JSON                — returns delta snapshot, resets counters
  start(interval, endpoint, instanceId, gatewayToken)
  shutdown()                     — final flush, stop timer
```

### Instrumentation points

| Counter | Hermes (Python) | OpenClaw (TypeScript) |
|---|---|---|
| `messages_in` | `ConvosAdapter` — on inbound message | `channel.ts` — on inbound message |
| `messages_out` | `ConvosAdapter._dispatch_response()` | `convosOutbound()` |
| `tools_invoked` | `AgentRunner` — on tool call | OpenClaw plugin SDK — tool hook |
| `skills_invoked` | `AgentRunner` — on skill load | OpenClaw plugin SDK — skill hook |
| `group_member_count` | `ConvosInstance.get_group_members()` | `ConvosInstance` member list |

Each instrumentation point is a single line: `stats.increment("messages_in")`.

### Failure handling

If the Worker is unreachable, the runtime silently drops that tick's stats and tries again next interval. No buffering, no retry queue. Losing a few ticks doesn't matter for product analytics.

If a flush fails, accumulated deltas are lost. The next flush starts from zero. This creates a gap in the data, not a double-count. This is the correct behavior — implementers should not attempt to recover or re-send lost deltas.

### Shutdown flush

- Hermes: hooks into FastAPI lifespan shutdown.
- OpenClaw: hooks into existing process cleanup path.

This is best-effort. Railway sends SIGTERM during deploys with a limited shutdown window. If the Worker is unreachable during shutdown, the final flush is lost. This is acceptable — the last tick's data (at most 60s of counters) is a small fraction of the instance's total lifetime data.

## Dashboard Reference

### (a) Engagement — Primary

| Question | PostHog query |
|---|---|
| Are people using their agents? | `messages_in > 0` instances over time |
| How many messages/day across all instances? | Sum `messages_in` per day |
| Do conversations go quiet after day 1? | Retention: cohort by claim date, measure `messages_in > 0` on day N |
| Which instances are most/least active? | Leaderboard: sum `messages_in` by `instance_id`, last 7 days |
| Human-to-agent message ratio? | `sum(messages_in)` vs `sum(messages_out)` |

### (b) Quality — Secondary

| Question | PostHog query |
|---|---|
| Agents talking to themselves? | Instances where `messages_out >> messages_in` |
| Dead conversations? | `is_active: true` but `seconds_since_last_message_in > 86400` |
| Cost per message? | `credits_spend_delta / messages_out` per instance |
| Burning credits with no engagement? | High `credits_spend_delta`, low `messages_in` |

### (c) Feature Adoption — Tertiary

| Question | PostHog query |
|---|---|
| How often are tools used? | Sum `tools_invoked` over time |
| % of conversations using tools? | Instances with `tools_invoked > 0` / total active |
| Skills usage rate? | Same pattern with `skills_invoked` |

### Not answerable yet (future extensions)

- **Which specific tools/skills** — needs per-tool/skill breakdown (add `_by_type` when needed)
- **Conversation quality scoring** — needs content signals (out of scope: counts only)
- **Per-user engagement** — E2E encrypted, no user-level tracking by design
- **Retention cohort by claim date** — claim dates live in pool Postgres, not PostHog. For now, join manually. Future: emit `instance_claimed` / `instance_destroyed` lifecycle events from the pool manager to PostHog so cohort analysis is self-contained.

## Emission Interval Rationale

- **60s for usage stats:** Industry standard for product telemetry (Datadog default is 15s, but that's for infra alerting). 15s is 4x the cost with no value for engagement analysis. 5min loses too much resolution for daily trends.
- **15min for credits:** OpenRouter usage doesn't change as fast as message counts. 15min provides sufficient resolution for spend trends while keeping OpenRouter API calls manageable at scale.
- **Final flush on shutdown:** Always emit remaining counters before the process exits. Otherwise you lose the tail of every conversation.

## Scale Considerations

- **Worker throughput:** 10k instances at 60s = ~167 req/sec. Well within CF Workers capacity. Each request is a simple auth lookup (KV cache hit) + PostHog forward.
- **Postgres load:** Token validation cached in KV (5min TTL). Steady-state DB queries: ~33/sec average (one per unique instance per TTL window). Comfortable for the pool Postgres.
- **PostHog forwarding:** 167 req/sec to PostHog's `/capture` endpoint. PostHog handles this natively — no batching needed for Pipeline 1.
- **Credits sweep:** OpenRouter `listKeys()` paginates all keys every 15min. At 10k keys with page size ~100, this is ~100 sequential API calls. Throttled at 100ms/page = ~10s total. If OpenRouter rate-limits, sweep can resume across cron invocations via KV-stored pagination offset.
- **PostHog event volume:** 10k active instances x 1 event/min x 30 days = ~432M events/month (Pipeline 1) + ~29M (Pipeline 2) = ~461M total. At PostHog cloud pricing this is significant (~$450-800/mo). Mitigations: increase emission interval to 5min (~92M total), only emit when counters are non-zero, or self-host PostHog. Note: not all 10k instances will be active simultaneously — actual volume scales with claimed instances.
- **KV limits:** Cloudflare KV supports 1,000 writes/sec. Auth cache: ~33 writes/sec. Credits sweep: ~100 writes/sec during sweep. Well within limits.

## Schema Versioning

The runtime includes a `schema_version: 1` field in the stats payload. The Worker passes this through to PostHog as a property. If the schema changes (new fields, renamed fields, changed semantics), bump the version. PostHog consumers can filter or branch on `schema_version` to handle mixed-version data during rollouts.
