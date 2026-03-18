/**
 * Stats accumulator — collects usage counters and posts directly to PostHog.
 *
 * Usage:
 *   import { stats } from "./stats.js";
 *   stats.increment("messages_in");
 *   stats.set("group_member_count", 4);
 *   stats.start({ posthogApiKey, posthogHost, instanceId, agentName });
 *   await stats.shutdown();
 */

const SCHEMA_VERSION = 1;
const FLUSH_INTERVAL_MS = 60_000;
const FLUSH_TIMEOUT_MS = 5_000;

class StatsAccumulator {
  private counters: Record<string, number> = {};
  private gauges: Record<string, number> = {};
  private lastMessageInAt = 0;
  private posthogApiKey = "";
  private posthogHost = "";
  private instanceId = "";
  private agentName = "";
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

  private buildPostHogBatch(): Record<string, unknown> {
    const now = Date.now();
    const secondsSince =
      this.lastMessageInAt > 0
        ? Math.round((now - this.lastMessageInAt) / 1000)
        : -1;
    const ts = new Date().toISOString();
    return {
      api_key: this.posthogApiKey,
      batch: [{
        event: "instance_stats",
        distinct_id: `instance:${this.instanceId}`,
        timestamp: ts,
        properties: {
          schema_version: SCHEMA_VERSION,
          instance_id: this.instanceId,
          runtime: this.runtime,
          messages_in: this.counters.messages_in ?? 0,
          messages_out: this.counters.messages_out ?? 0,
          tools_invoked: this.counters.tools_invoked ?? 0,
          skills_invoked: this.counters.skills_invoked ?? 0,
          group_member_count: this.gauges.group_member_count ?? 0,
          is_active: true,
          seconds_since_last_message_in: secondsSince,
          $set: {
            agent_name: this.agentName,
            runtime: this.runtime,
          },
        },
      }],
      sent_at: ts,
    };
  }

  flush(): Record<string, unknown> {
    const batch = this.buildPostHogBatch();
    this.counters = {};
    return batch;
  }

  private async send(batch: Record<string, unknown>): Promise<void> {
    if (!this.posthogApiKey) return;
    const url = `${this.posthogHost}/batch/`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batch),
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
    posthogApiKey: string;
    posthogHost?: string;
    instanceId: string;
    agentName?: string;
    runtime?: string;
  }): void {
    if (this.started) return;
    this.posthogApiKey = opts.posthogApiKey;
    this.posthogHost = (opts.posthogHost || "https://us.i.posthog.com").replace(/\/+$/, "");
    this.instanceId = opts.instanceId;
    this.agentName = opts.agentName || "";
    if (opts.runtime) this.runtime = opts.runtime;
    this.started = true;

    this.timer = setInterval(() => {
      const batch = this.flush();
      this.send(batch).catch(() => {});
    }, FLUSH_INTERVAL_MS);

    // Don't hold the process open for stats
    if (this.timer && typeof this.timer === "object" && "unref" in this.timer) {
      this.timer.unref();
    }

    console.log(`[stats] started (instance=${opts.instanceId}, interval=${FLUSH_INTERVAL_MS / 1000}s)`);
  }

  async shutdown(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const batch = this.flush();
    await this.send(batch);
    this.started = false;
    console.log("[stats] shut down (final flush sent)");
  }
}

export const stats = new StatsAccumulator();
