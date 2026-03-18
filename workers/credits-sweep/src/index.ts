import postgres from "postgres";

export interface Env {
  STATS_CREDITS: KVNamespace;
  POOL_DB: Hyperdrive;
  POSTHOG_API_KEY: string;
  OPENROUTER_MANAGEMENT_KEY: string;
  POSTHOG_HOST?: string;
}

function getSQL(env: Env) {
  return postgres(env.POOL_DB.connectionString, { ssl: "require", max: 1 });
}

async function creditsSweep(env: Env): Promise<void> {
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

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(creditsSweep(env));
  },
};
