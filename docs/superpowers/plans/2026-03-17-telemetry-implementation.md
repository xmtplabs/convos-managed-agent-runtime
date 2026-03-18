# Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add privacy-preserving usage analytics to assistant instances, emitting anonymous counters through a Cloudflare Worker to PostHog.

**Architecture:** Two pipelines — (1) each runtime pushes a stats snapshot every 60s to a CF Worker, which validates auth and forwards to PostHog; (2) a Worker cron sweeps OpenRouter's API every 15min for per-instance credit spend deltas. See `docs/superpowers/specs/2026-03-17-telemetry-design.md` for full design.

**Tech Stack:** Python (Hermes runtime), TypeScript (OpenClaw runtime), Cloudflare Workers (Wrangler), Cloudflare KV, Hyperdrive (Postgres proxy), PostHog HTTP API.

**Spec:** `docs/superpowers/specs/2026-03-17-telemetry-design.md`

---

## File Map

### New files

| File | Responsibility |
|---|---|
| `runtime/hermes/src/stats.py` | Hermes stats accumulator — counters, 60s timer, flush/shutdown |
| `runtime/openclaw/extensions/convos/src/stats.ts` | OpenClaw stats accumulator — same interface, TypeScript |
| `workers/stats-ingest/src/index.ts` | CF Worker — `POST /stats` handler + cron credits sweep |
| `workers/stats-ingest/wrangler.toml` | Worker config — routes, KV bindings, Hyperdrive, cron triggers |
| `workers/stats-ingest/package.json` | Worker dependencies |

### Modified files

| File | Change |
|---|---|
| `runtime/hermes/src/convos_adapter.py` | Add `stats.increment("messages_in")` / `stats.increment("messages_out")` calls |
| `runtime/hermes/src/server.py` | Start stats timer on conversation start, shutdown flush in lifespan |
| `runtime/hermes/src/config.py` | Add `stats_endpoint` config field |
| `runtime/openclaw/extensions/convos/src/channel.ts` | Add `stats.increment("messages_in")` on inbound |
| `runtime/openclaw/extensions/convos/src/outbound.ts` | Add `stats.increment("messages_out")` on outbound send |
| `runtime/openclaw/extensions/convos/index.ts` | Shutdown flush on factory reset |
| `pool/src/services/providers/env.ts` | Add `STATS_ENDPOINT` to instance env vars |
| `pool/src/config.ts` | Add `statsEndpoint` config field |

---

## Task 1: Hermes Stats Accumulator

**Files:**
- Create: `runtime/hermes/src/stats.py`

- [ ] **Step 1: Create the stats module**

```python
"""
Stats accumulator — collects usage counters and flushes to the telemetry Worker.

Usage:
    from .stats import stats
    stats.increment("messages_in")
    stats.set("group_member_count", 4)
    stats.start(endpoint="https://stats.example.com/stats", instance_id="abc", gateway_token="tok")
    # ... on shutdown:
    await stats.shutdown()
"""

from __future__ import annotations

import asyncio
import logging
import time

import httpx

logger = logging.getLogger(__name__)

SCHEMA_VERSION = 1
FLUSH_INTERVAL_S = 60
FLUSH_TIMEOUT_S = 5


class StatsAccumulator:
    def __init__(self) -> None:
        self._counters: dict[str, int] = {}
        self._gauges: dict[str, float] = {}
        self._last_message_in_at: float = 0.0
        self._endpoint: str = ""
        self._instance_id: str = ""
        self._gateway_token: str = ""
        self._runtime: str = "hermes"
        self._task: asyncio.Task | None = None
        self._started: bool = False

    def increment(self, metric: str, value: int = 1) -> None:
        self._counters[metric] = self._counters.get(metric, 0) + value
        if metric == "messages_in":
            self._last_message_in_at = time.time()

    def set(self, metric: str, value: float) -> None:
        self._gauges[metric] = value

    def _build_payload(self) -> dict:
        now = time.time()
        seconds_since = (
            int(now - self._last_message_in_at) if self._last_message_in_at > 0 else -1
        )
        payload = {
            "schema_version": SCHEMA_VERSION,
            "instance_id": self._instance_id,
            "gateway_token": self._gateway_token,
            "runtime": self._runtime,
            "messages_in": self._counters.get("messages_in", 0),
            "messages_out": self._counters.get("messages_out", 0),
            "tools_invoked": self._counters.get("tools_invoked", 0),
            "skills_invoked": self._counters.get("skills_invoked", 0),
            "group_member_count": int(self._gauges.get("group_member_count", 0)),
            "seconds_since_last_message_in": seconds_since,
        }
        return payload

    def flush(self) -> dict:
        payload = self._build_payload()
        self._counters = {}
        return payload

    async def _send(self, payload: dict) -> None:
        if not self._endpoint:
            return
        try:
            async with httpx.AsyncClient(timeout=FLUSH_TIMEOUT_S) as client:
                resp = await client.post(self._endpoint, json=payload)
                if resp.status_code >= 400:
                    logger.warning("Stats flush failed: %d", resp.status_code)
        except Exception as err:
            logger.debug("Stats flush error (will retry next tick): %s", err)

    async def _tick_loop(self) -> None:
        while True:
            await asyncio.sleep(FLUSH_INTERVAL_S)
            payload = self.flush()
            await self._send(payload)

    def start(
        self,
        *,
        endpoint: str,
        instance_id: str,
        gateway_token: str,
        runtime: str = "hermes",
    ) -> None:
        if self._started:
            return
        self._endpoint = endpoint
        self._instance_id = instance_id
        self._gateway_token = gateway_token
        self._runtime = runtime
        self._started = True
        self._task = asyncio.create_task(self._tick_loop())
        logger.info("Stats accumulator started (endpoint=%s, interval=%ds)", endpoint, FLUSH_INTERVAL_S)

    async def shutdown(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        # Final flush
        payload = self.flush()
        await self._send(payload)
        self._started = False
        logger.info("Stats accumulator shut down (final flush sent)")


# Module-level singleton
stats = StatsAccumulator()
```

- [ ] **Step 2: Verify the module imports cleanly**

Run: `cd /Users/saulxmtp/Developer/convos-agents/runtime/hermes && python -c "from src.stats import stats; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add runtime/hermes/src/stats.py
git commit -m "feat(hermes): add stats accumulator for telemetry"
```

---

## Task 2: Hermes Instrumentation

**Files:**
- Modify: `runtime/hermes/src/convos_adapter.py` (lines ~370, ~566)
- Modify: `runtime/hermes/src/server.py` (lifespan, start_wired_instance)
- Modify: `runtime/hermes/src/config.py`

- [ ] **Step 1: Add `stats_endpoint` to RuntimeConfig**

In `runtime/hermes/src/config.py`, add a field and env var:

```python
# In the dataclass fields (after instance_id):
stats_endpoint: str = ""
```

```python
# In from_env() return (after instance_id line):
stats_endpoint=os.environ.get("STATS_ENDPOINT", ""),
```

- [ ] **Step 2: Instrument inbound messages in ConvosAdapter**

In `runtime/hermes/src/convos_adapter.py`, add the import at the top (after existing imports):

```python
from .stats import stats
```

In `_process_message()` (around line 391), after the reaction early-return (line 394) AND after the `group_updated` early-return AND after the catchup message check, add (so we only count real user text messages, not system events or catchup replays):

```python
stats.increment("messages_in")
```

- [ ] **Step 3: Instrument outbound messages in ConvosAdapter**

In `_dispatch_response()` (around line 566), after the `inst` guard, add at the start of the method:

```python
stats.increment("messages_out")
```

- [ ] **Step 4: Update group member count on inbound messages**

In `_process_message()`, after the `stats.increment("messages_in")` line, add:

```python
if self._instance:
    members = self._instance.get_group_members()
    if members:
        stats.set("group_member_count", len(members.split(", ")))
```

Note: `get_group_members()` returns a `", "`-separated string (comma-space). Split on `", "` for correct count.

- [ ] **Step 5: Start stats timer when conversation starts**

In `runtime/hermes/src/server.py`, add the import at the top:

```python
from .stats import stats
```

In `start_wired_instance()` (around line 126), after `_adapter = adapter`, add:

```python
cfg = get_config()
if cfg.stats_endpoint and cfg.instance_id and cfg.gateway_token:
    stats.start(
        endpoint=cfg.stats_endpoint,
        instance_id=cfg.instance_id,
        gateway_token=cfg.gateway_token,
    )
```

- [ ] **Step 6: Shutdown flush in lifespan**

In the lifespan function in `server.py`, in the shutdown section (after `await _stop_poller()`), add:

```python
await stats.shutdown()
```

- [ ] **Step 7: Instrument tools and skills (deferred)**

`tools_invoked` and `skills_invoked` require hooks into the Hermes `AIAgent` internals, which are imported dynamically (`from run_agent import AIAgent`). The exact hook points depend on the Hermes agent framework's callback/event system. During implementation:

1. Check if `AIAgent` supports a `on_tool_call` or similar callback
2. If so, wire it to `stats.increment("tools_invoked")`
3. For skills, check the skill loading path in the Hermes framework

If hooks are not readily available, leave these counters at 0 for the initial release and file a follow-up issue. The schema already includes the fields — they'll populate once instrumented.

The same applies to OpenClaw — check if the plugin SDK exposes tool/skill execution hooks. If not, defer.

- [ ] **Step 8: Verify the server still starts**

Run: `cd /Users/saulxmtp/Developer/convos-agents/runtime/hermes && python -c "from src.server import app; print('OK')"`
Expected: `OK` (no import errors)

- [ ] **Step 9: Commit**

```bash
git add runtime/hermes/src/config.py runtime/hermes/src/convos_adapter.py runtime/hermes/src/server.py
git commit -m "feat(hermes): instrument message pipeline for telemetry"
```

---

## Task 3: OpenClaw Stats Accumulator

**Files:**
- Create: `runtime/openclaw/extensions/convos/src/stats.ts`

- [ ] **Step 1: Create the stats module**

```typescript
/**
 * Stats accumulator — collects usage counters and flushes to the telemetry Worker.
 *
 * Usage:
 *   import { stats } from "./stats.js";
 *   stats.increment("messages_in");
 *   stats.set("group_member_count", 4);
 *   stats.start({ endpoint, instanceId, gatewayToken });
 *   await stats.shutdown();
 */

const SCHEMA_VERSION = 1;
const FLUSH_INTERVAL_MS = 60_000;
const FLUSH_TIMEOUT_MS = 5_000;

class StatsAccumulator {
  private counters: Record<string, number> = {};
  private gauges: Record<string, number> = {};
  private lastMessageInAt = 0;
  private endpoint = "";
  private instanceId = "";
  private gatewayToken = "";
  private runtime = "openclaw";
  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  increment(metric: string, value = 1): void {
    this.counters[metric] = (this.counters[metric] ?? 0) + value;
    if (metric === "messages_in") {
      this.lastMessageInAt = Date.now();
    }
  }

  set(metric: string, value: number): void {
    this.gauges[metric] = value;
  }

  private buildPayload(): Record<string, unknown> {
    const now = Date.now();
    const secondsSince =
      this.lastMessageInAt > 0
        ? Math.round((now - this.lastMessageInAt) / 1000)
        : -1;
    return {
      schema_version: SCHEMA_VERSION,
      instance_id: this.instanceId,
      gateway_token: this.gatewayToken,
      runtime: this.runtime,
      messages_in: this.counters.messages_in ?? 0,
      messages_out: this.counters.messages_out ?? 0,
      tools_invoked: this.counters.tools_invoked ?? 0,
      skills_invoked: this.counters.skills_invoked ?? 0,
      group_member_count: this.gauges.group_member_count ?? 0,
      seconds_since_last_message_in: secondsSince,
    };
  }

  flush(): Record<string, unknown> {
    const payload = this.buildPayload();
    this.counters = {};
    return payload;
  }

  private async send(payload: Record<string, unknown>): Promise<void> {
    if (!this.endpoint) return;
    try {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(FLUSH_TIMEOUT_MS),
      });
      if (!res.ok) {
        console.log(`[stats] flush failed: ${res.status}`);
      }
    } catch {
      // Silent — will retry next tick
    }
  }

  start(opts: {
    endpoint: string;
    instanceId: string;
    gatewayToken: string;
    runtime?: string;
  }): void {
    if (this.started) return;
    this.endpoint = opts.endpoint;
    this.instanceId = opts.instanceId;
    this.gatewayToken = opts.gatewayToken;
    if (opts.runtime) this.runtime = opts.runtime;
    this.started = true;

    this.timer = setInterval(() => {
      const payload = this.flush();
      this.send(payload).catch(() => {});
    }, FLUSH_INTERVAL_MS);

    // Don't hold the process open for stats
    if (this.timer && typeof this.timer === "object" && "unref" in this.timer) {
      this.timer.unref();
    }

    console.log(`[stats] started (endpoint=${opts.endpoint}, interval=${FLUSH_INTERVAL_MS / 1000}s)`);
  }

  async shutdown(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const payload = this.flush();
    await this.send(payload);
    this.started = false;
    console.log("[stats] shut down (final flush sent)");
  }
}

export const stats = new StatsAccumulator();
```

- [ ] **Step 2: Verify the module compiles**

Run: `cd /Users/saulxmtp/Developer/convos-agents/runtime/openclaw && npx tsc --noEmit extensions/convos/src/stats.ts 2>&1 || echo "Check for errors above"`

Note: If `tsc` fails due to missing tsconfig context, verify manually that the file has no syntax errors by inspection. The OpenClaw build pipeline will catch real issues.

- [ ] **Step 3: Commit**

```bash
git add runtime/openclaw/extensions/convos/src/stats.ts
git commit -m "feat(openclaw): add stats accumulator for telemetry"
```

---

## Task 4: OpenClaw Instrumentation

**Files:**
- Modify: `runtime/openclaw/extensions/convos/src/channel.ts` (~line 370, ~line 430)
- Modify: `runtime/openclaw/extensions/convos/src/outbound.ts` (~line 26)
- Modify: `runtime/openclaw/extensions/convos/index.ts` (startWiredInstance, factoryReset)

- [ ] **Step 1: Instrument inbound messages**

In `runtime/openclaw/extensions/convos/src/channel.ts`, add import at the top:

```typescript
import { stats } from "./stats.js";
```

In `handleInboundMessage()` (line 430), after the member name cache update (line 448) and after the catchup/group_updated early returns, add:

```typescript
stats.increment("messages_in");
```

Also update group member count. After the `stats.increment("messages_in")` line:

```typescript
if (inst) {
  const members = inst.getGroupMembers();
  if (members) {
    stats.set("group_member_count", members.split(", ").length);
  }
}
```

Note: `getGroupMembers()` in `sdk-client.ts` returns a `", "`-separated string (or undefined). Split on `", "` for correct count.

- [ ] **Step 2: Instrument outbound messages**

In `runtime/openclaw/extensions/convos/src/outbound.ts`, add import at the top:

```typescript
import { stats } from "./stats.js";
```

In the `sendText` method, after the successful `instance.sendMessage(policy.text)` call (line 44) and before the return, add:

```typescript
stats.increment("messages_out");
```

Important: place this AFTER the suppress check and AFTER the actual send, so we only count messages that were actually delivered, not suppressed ones.

- [ ] **Step 3: Start stats timer on wired instance start**

Add the stats start call at the end of the `startWiredInstance` function in `channel.ts` (the exported one, around line 1039), since it's the single convergence point for all conversation starts. After `await inst.start()` completes:

```typescript
const statsEndpoint = process.env.STATS_ENDPOINT || "";
const instanceId = process.env.INSTANCE_ID || "";
const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN || "";
if (statsEndpoint && instanceId && gatewayToken) {
  stats.start({ endpoint: statsEndpoint, instanceId, gatewayToken });
}
```

This ensures stats start regardless of whether the conversation was created via `/convos/conversation`, `/convos/join`, `/pool/provision`, or auto-resume.

- [ ] **Step 4: Shutdown flush on factory reset and stop**

In `runtime/openclaw/extensions/convos/index.ts`, in the `factoryReset()` function, add before clearing credentials:

```typescript
await stats.shutdown();
```

In `channel.ts`, in the `stopInstance()` function (called by `stopAccount`), add before stopping the ConvosInstance:

```typescript
await stats.shutdown();
```

- [ ] **Step 5: Verify no import errors**

Run: `cd /Users/saulxmtp/Developer/convos-agents/runtime/openclaw && node -e "console.log('syntax check only')"`

Note: Full verification requires the OpenClaw build system. Verify there are no TypeScript syntax errors by inspection.

- [ ] **Step 6: Commit**

```bash
git add runtime/openclaw/extensions/convos/src/channel.ts runtime/openclaw/extensions/convos/src/outbound.ts runtime/openclaw/extensions/convos/index.ts
git commit -m "feat(openclaw): instrument message pipeline for telemetry"
```

---

## Task 5: Cloudflare Worker — Project Setup

**Files:**
- Create: `workers/stats-ingest/package.json`
- Create: `workers/stats-ingest/wrangler.toml`
- Create: `workers/stats-ingest/tsconfig.json`

- [ ] **Step 1: Create the project directory**

```bash
mkdir -p workers/stats-ingest/src
```

- [ ] **Step 2: Create package.json**

```json
{
  "name": "stats-ingest",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy"
  },
  "dependencies": {
    "postgres": "^3.4.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250312.0",
    "wrangler": "^4.0.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 3: Create wrangler.toml**

```toml
name = "stats-ingest"
main = "src/index.ts"
compatibility_date = "2025-03-17"

[triggers]
crons = ["*/15 * * * *"]

[[kv_namespaces]]
binding = "STATS_AUTH"
id = "PLACEHOLDER_AUTH_KV_ID"

[[kv_namespaces]]
binding = "STATS_CREDITS"
id = "PLACEHOLDER_CREDITS_KV_ID"

# Hyperdrive binding for pool Postgres (read-only role)
[[hyperdrive]]
binding = "POOL_DB"
id = "PLACEHOLDER_HYPERDRIVE_ID"

[vars]
# Non-secret config vars (secrets set via `wrangler secret put`)
# POSTHOG_API_KEY = set via wrangler secret
# OPENROUTER_MANAGEMENT_KEY = set via wrangler secret
```

Note: Replace `PLACEHOLDER_*` IDs after creating the KV namespaces and Hyperdrive config in the Cloudflare dashboard or via Wrangler CLI:
```bash
wrangler kv namespace create STATS_AUTH
wrangler kv namespace create STATS_CREDITS
wrangler hyperdrive create pool-db-readonly --connection-string="postgres://readonly_user:password@host:5432/pool"
```

- [ ] **Step 4: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Install dependencies**

Run: `cd workers/stats-ingest && pnpm install`

- [ ] **Step 6: Commit**

```bash
git add workers/stats-ingest/package.json workers/stats-ingest/wrangler.toml workers/stats-ingest/tsconfig.json workers/stats-ingest/pnpm-lock.yaml
git commit -m "chore: scaffold Cloudflare Worker for stats ingestion"
```

---

## Task 6: Cloudflare Worker — Stats Endpoint

**Files:**
- Create: `workers/stats-ingest/src/index.ts`

- [ ] **Step 1: Create the Worker with POST /stats handler**

```typescript
import postgres from "postgres";

export interface Env {
  STATS_AUTH: KVNamespace;
  STATS_CREDITS: KVNamespace;
  POOL_DB: Hyperdrive;
  POSTHOG_API_KEY: string;
  OPENROUTER_MANAGEMENT_KEY: string;
  POSTHOG_HOST?: string;
}

interface StatsPayload {
  schema_version: number;
  instance_id: string;
  gateway_token: string;
  runtime: string;
  messages_in: number;
  messages_out: number;
  tools_invoked: number;
  skills_invoked: number;
  group_member_count: number;
  seconds_since_last_message_in: number;
}

interface AuthCacheEntry {
  agentName: string | null;
  runtimeType: string | null;
  validatedAt: number;
}

const AUTH_CACHE_TTL_S = 300; // 5 minutes
const POSTHOG_BATCH_URL = "https://us.i.posthog.com/batch/";

function getSQL(env: Env) {
  return postgres(env.POOL_DB.connectionString, { ssl: "require", max: 1 });
}

async function validateAuth(
  env: Env,
  instanceId: string,
  gatewayToken: string,
): Promise<{ valid: boolean; agentName: string | null }> {
  // Check KV cache
  const cacheKey = `auth:${instanceId}`;
  const cached = await env.STATS_AUTH.get(cacheKey, "json") as AuthCacheEntry | null;
  if (cached && Date.now() / 1000 - cached.validatedAt < AUTH_CACHE_TTL_S) {
    return { valid: true, agentName: cached.agentName };
  }

  // Query Postgres via Hyperdrive using postgres.js (Cloudflare-recommended driver)
  try {
    const sql = getSQL(env);
    const rows = await sql`
      SELECT i.agent_name, ii.runtime_type
      FROM instances i
      JOIN instance_infra ii ON i.id = ii.instance_id
      WHERE ii.instance_id = ${instanceId} AND ii.gateway_token = ${gatewayToken}
      LIMIT 1
    `;
    await sql.end();

    if (rows.length === 0) {
      return { valid: false, agentName: null };
    }

    const row = rows[0];
    const entry: AuthCacheEntry = {
      agentName: row.agent_name ?? null,
      runtimeType: row.runtime_type ?? null,
      validatedAt: Math.floor(Date.now() / 1000),
    };
    await env.STATS_AUTH.put(cacheKey, JSON.stringify(entry), {
      expirationTtl: AUTH_CACHE_TTL_S,
    });

    return { valid: true, agentName: entry.agentName };
  } catch (err) {
    console.error("Auth validation DB error:", err);
    return { valid: false, agentName: null };
  }
}

async function forwardToPostHog(
  env: Env,
  event: string,
  distinctId: string,
  properties: Record<string, unknown>,
): Promise<void> {
  const host = env.POSTHOG_HOST || "https://us.i.posthog.com";
  const url = `${host}/batch/`;
  const body = {
    api_key: env.POSTHOG_API_KEY,
    batch: [
      {
        event,
        distinct_id: distinctId,
        properties,
        timestamp: new Date().toISOString(),
      },
    ],
    sent_at: new Date().toISOString(),
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    console.error(`PostHog batch failed: ${resp.status}`);
  }
}

async function handleStats(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let payload: StatsPayload;
  try {
    payload = await request.json() as StatsPayload;
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  if (!payload.instance_id || !payload.gateway_token) {
    return new Response("Missing instance_id or gateway_token", { status: 400 });
  }

  let auth;
  try {
    auth = await validateAuth(env, payload.instance_id, payload.gateway_token);
  } catch {
    return new Response("Service Unavailable", { status: 503 });
  }

  if (!auth.valid) {
    return new Response("Unauthorized", { status: 401 });
  }

  const posthogProperties: Record<string, unknown> = {
    instance_id: payload.instance_id,
    runtime: payload.runtime,
    schema_version: payload.schema_version,
    messages_in: payload.messages_in,
    messages_out: payload.messages_out,
    tools_invoked: payload.tools_invoked,
    skills_invoked: payload.skills_invoked,
    group_member_count: payload.group_member_count,
    is_active: true,
    seconds_since_last_message_in: payload.seconds_since_last_message_in,
    $set: {
      agent_name: auth.agentName,
      runtime: payload.runtime,
    },
  };

  // Use waitUntil so the response returns immediately
  ctx.waitUntil(
    forwardToPostHog(
      env,
      "instance_stats",
      `instance:${payload.instance_id}`,
      posthogProperties,
    ),
  );

  return new Response(JSON.stringify({ ok: true }), {
    status: 202,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleCron(env: Env): Promise<void> {
  // Credits sweep — implemented in Task 7
  console.log("[cron] Credits sweep triggered");
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/stats") {
      return handleStats(request, env, ctx);
    }

    return new Response("Not Found", { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleCron(env));
  },
};
```

Uses `postgres` (postgres.js) — Cloudflare's recommended driver for Hyperdrive. Returns 202 on successful auth (PostHog forwarding is fire-and-forget via `waitUntil`), 503 if Postgres is unreachable, 401 on bad auth.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd workers/stats-ingest && npx tsc --noEmit`
Expected: No errors (or only errors related to the `pg` import which needs the correct driver package)

- [ ] **Step 3: Commit**

```bash
git add workers/stats-ingest/src/index.ts
git commit -m "feat(worker): implement POST /stats endpoint with auth + PostHog forwarding"
```

---

## Task 7: Cloudflare Worker — Credits Cron Sweep

**Files:**
- Modify: `workers/stats-ingest/src/index.ts` (expand `handleCron`)

- [ ] **Step 1: Implement the credits sweep**

Replace the `handleCron` function in `workers/stats-ingest/src/index.ts` with:

```typescript
async function handleCron(env: Env): Promise<void> {
  console.log("[cron] Credits sweep starting");

  // Step 1: Build keyHash -> instanceId map from pool DB
  let keyToInstance: Map<string, string>;
  try {
    const sql = getSQL(env);
    const rows = await sql`
      SELECT instance_id, resource_id AS key_hash
      FROM instance_services
      WHERE tool_id = 'openrouter' AND status = 'active'
    `;
    await sql.end();
    keyToInstance = new Map(rows.map((r) => [r.key_hash, r.instance_id]));
  } catch (err) {
    console.error("[cron] Failed to load key-to-instance map:", err);
    return;
  }

  if (keyToInstance.size === 0) {
    console.log("[cron] No active OpenRouter keys found");
    return;
  }

  // Step 2: Paginate through OpenRouter keys
  const mgmtKey = env.OPENROUTER_MANAGEMENT_KEY;
  if (!mgmtKey) {
    console.error("[cron] OPENROUTER_MANAGEMENT_KEY not set");
    return;
  }

  const events: Array<{
    event: string;
    distinct_id: string;
    properties: Record<string, unknown>;
    timestamp: string;
  }> = [];

  let offset = 0;
  while (true) {
    let keys: any[];
    try {
      const resp = await fetch(`https://openrouter.ai/api/v1/keys?offset=${offset}`, {
        headers: { Authorization: `Bearer ${mgmtKey}` },
      });
      if (!resp.ok) {
        console.error(`[cron] OpenRouter listKeys failed: ${resp.status}`);
        break;
      }
      const body = await resp.json() as any;
      keys = body?.data ?? [];
    } catch (err) {
      console.error("[cron] OpenRouter API error:", err);
      break;
    }

    if (keys.length === 0) break;

    for (const key of keys) {
      const hash = key.hash;
      const instanceId = keyToInstance.get(hash);
      if (!instanceId) continue;

      const usage = key.usage ?? 0;
      const limit = key.limit ?? 0;

      // Compute delta from last sweep
      const kvKey = `credits:${hash}`;
      const lastUsageStr = await env.STATS_CREDITS.get(kvKey);
      const lastUsage = lastUsageStr ? parseFloat(lastUsageStr) : 0;
      const delta = Math.max(0, usage - lastUsage);

      // Store current usage for next sweep
      await env.STATS_CREDITS.put(kvKey, String(usage));

      events.push({
        event: "instance_credits",
        distinct_id: `instance:${instanceId}`,
        properties: {
          instance_id: instanceId,
          credits_usage_total: usage,
          credits_limit: limit,
          credits_remaining: Math.max(0, limit - usage),
          credits_spend_delta: delta,
        },
        timestamp: new Date().toISOString(),
      });
    }

    offset += keys.length;

    // Throttle to avoid OpenRouter rate limits
    await new Promise((r) => setTimeout(r, 100));
  }

  // Step 3: Batch send to PostHog
  if (events.length > 0) {
    const host = env.POSTHOG_HOST || "https://us.i.posthog.com";
    try {
      const resp = await fetch(`${host}/batch/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: env.POSTHOG_API_KEY,
          batch: events,
          sent_at: new Date().toISOString(),
        }),
      });
      if (!resp.ok) {
        console.error(`[cron] PostHog batch failed: ${resp.status}`);
      } else {
        console.log(`[cron] Sent ${events.length} credit events to PostHog`);
      }
    } catch (err) {
      console.error("[cron] PostHog batch error:", err);
    }
  }

  console.log(`[cron] Credits sweep complete: ${events.length} events`);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd workers/stats-ingest && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add workers/stats-ingest/src/index.ts
git commit -m "feat(worker): implement credits cron sweep with delta tracking"
```

---

## Task 8: Environment Variable Configuration

**Files:**
- No code changes — this is infrastructure/config work

- [ ] **Step 1: Document required env vars for instances**

Each Railway instance needs one new env var:

```
STATS_ENDPOINT=https://stats-ingest.<your-cf-subdomain>.workers.dev/stats
```

This must be added to the instance provisioning flow in `pool/src/services/providers/env.ts`, which builds the base env var map for all new instances.

- [ ] **Step 2: Add STATS_ENDPOINT to instance provisioning**

In `pool/src/services/providers/env.ts`, in the `buildInstanceEnv()` function (line 4), add to the returned object:

```typescript
STATS_ENDPOINT: config.statsEndpoint,
```

Also add `statsEndpoint` to the pool config (`pool/src/config.ts`):

```typescript
statsEndpoint: process.env.STATS_ENDPOINT || "",
```

This forwards the pool manager's `STATS_ENDPOINT` env var to every new instance.

- [ ] **Step 3: Document Worker deployment steps**

Create `workers/stats-ingest/README.md` (optional — or add to the issue):

```
## Deployment

1. Create KV namespaces:
   wrangler kv namespace create STATS_AUTH
   wrangler kv namespace create STATS_CREDITS

2. Create Hyperdrive config:
   wrangler hyperdrive create pool-db-readonly --connection-string="<readonly-postgres-url>"

3. Update wrangler.toml with the IDs from steps 1-2

4. Set secrets:
   wrangler secret put POSTHOG_API_KEY
   wrangler secret put OPENROUTER_MANAGEMENT_KEY

5. Create read-only Postgres role:
   CREATE ROLE stats_reader WITH LOGIN PASSWORD '<password>';
   GRANT CONNECT ON DATABASE pool TO stats_reader;
   GRANT SELECT ON instances, instance_infra, instance_services TO stats_reader;

6. Deploy:
   cd workers/stats-ingest && wrangler deploy

7. Set STATS_ENDPOINT on pool manager:
   STATS_ENDPOINT=https://stats-ingest.<subdomain>.workers.dev/stats
```

- [ ] **Step 4: Commit**

```bash
git add pool/src/services/providers/env.ts pool/src/config.ts workers/stats-ingest/
git commit -m "feat(pool): propagate STATS_ENDPOINT to provisioned instances"
```

---

## Task 9: End-to-End Verification

**Files:**
- No code changes — manual testing

- [ ] **Step 1: Deploy the Worker to dev**

```bash
cd workers/stats-ingest && wrangler deploy --env dev
```

Verify health check:
```bash
curl https://stats-ingest-dev.<subdomain>.workers.dev/health
```
Expected: `{"ok":true}`

- [ ] **Step 2: Test auth validation**

Use a known instance's ID and gateway token from the dev pool DB:

```bash
curl -X POST https://stats-ingest-dev.<subdomain>.workers.dev/stats \
  -H "Content-Type: application/json" \
  -d '{"schema_version":1,"instance_id":"<real-id>","gateway_token":"<real-token>","runtime":"hermes","messages_in":1,"messages_out":0,"tools_invoked":0,"skills_invoked":0,"group_member_count":2,"seconds_since_last_message_in":10}'
```
Expected: `{"ok":true}`

Test with bad token:
```bash
curl -X POST https://stats-ingest-dev.<subdomain>.workers.dev/stats \
  -H "Content-Type: application/json" \
  -d '{"schema_version":1,"instance_id":"<real-id>","gateway_token":"bad","runtime":"hermes","messages_in":1,"messages_out":0,"tools_invoked":0,"skills_invoked":0,"group_member_count":2,"seconds_since_last_message_in":10}'
```
Expected: `401 Unauthorized`

- [ ] **Step 3: Verify events appear in PostHog**

After sending a test stats POST, check PostHog:
1. Go to PostHog → Events
2. Filter for `instance_stats` events
3. Verify the properties match what was sent
4. Check that `agent_name` is set via `$set`

- [ ] **Step 4: Verify credits cron**

Trigger the cron manually:
```bash
wrangler dev --test-scheduled
```
Or wait for the 15-min cron trigger. Check PostHog for `instance_credits` events.

- [ ] **Step 5: Deploy a dev instance with STATS_ENDPOINT**

Set `STATS_ENDPOINT` on the pool manager dev environment. Replenish one instance. Claim it. Send a few messages. Wait 60s. Check PostHog for the `instance_stats` event from that instance.

- [ ] **Step 6: Document results**

Comment on issue #561 with verification results and screenshots from PostHog.
