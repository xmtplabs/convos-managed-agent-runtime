// Key name formats:
//   New: "assistant-<environment>-<instanceId>"
//   Legacy: "convos-agent-<instanceId>"
const NEW_PREFIX = "assistant-";
const LEGACY_PREFIX = "convos-agent-";

function parseKeyName(name: string): { instanceId: string; environment: string } | null {
  if (name.startsWith(NEW_PREFIX)) {
    // assistant-<env>-<instanceId> — env is the first segment after prefix
    const rest = name.slice(NEW_PREFIX.length);
    const dashIdx = rest.indexOf("-");
    if (dashIdx === -1) return null;
    return { environment: rest.slice(0, dashIdx), instanceId: rest.slice(dashIdx + 1) };
  }
  if (name.startsWith(LEGACY_PREFIX)) {
    const instanceId = name.slice(LEGACY_PREFIX.length);
    return instanceId ? { instanceId, environment: "" } : null;
  }
  return null;
}

export interface Env {
  STATS_CREDITS: KVNamespace;
  POSTHOG_API_KEY: string;
  OPENROUTER_MANAGEMENT_KEY: string;
  POSTHOG_HOST?: string;
}

async function creditsSweep(env: Env): Promise<void> {
  console.log("[cron] Credits sweep starting");

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

  // Paginate through OpenRouter keys — instance ID and environment are
  // embedded in key name ("assistant-<env>-<id>" or legacy "convos-agent-<id>")
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
      const parsed = parseKeyName(key.name ?? "");
      if (!parsed) continue;
      const { instanceId, environment } = parsed;

      const hash = key.hash;
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
          environment,
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

  // Batch send to PostHog
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

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(creditsSweep(env));
  },
};
