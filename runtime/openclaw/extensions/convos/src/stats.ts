/**
 * Stats accumulator — collects usage counters and error logs, posts directly
 * to PostHog.  Errors are batched alongside stats on the same 60 s flush
 * interval so they cost zero extra HTTP calls.
 *
 * Usage:
 *   import { stats } from "./stats.js";
 *   stats.increment("messages_in");
 *   stats.set("group_member_count", 4);
 *   stats.start({ posthogApiKey, posthogHost, instanceId, agentName });
 *   await stats.shutdown();
 *
 * Error capture:
 *   stats.captureError("message send failed");
 *   // — or — after start(), console.error is auto-intercepted.
 */

const SCHEMA_VERSION = 1;
const FLUSH_INTERVAL_MS = 60_000;
const FLUSH_TIMEOUT_MS = 5_000;
const MAX_ERRORS_PER_FLUSH = 50;

interface ErrorEntry {
  message: string;
  timestamp: string;
}

class StatsAccumulator {
  private counters: Record<string, number> = {};
  private gauges: Record<string, number> = {};
  private errors: ErrorEntry[] = [];
  private lastMessageInAt = 0;
  private posthogApiKey = "";
  private posthogHost = "";
  private instanceId = "";
  private agentName = "";
  private runtime = "openclaw";
  private environment = "";
  private version = "";
  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private originalConsoleError: typeof console.error | null = null;

  increment(metric: string, value = 1): void {
    this.counters[metric] = (this.counters[metric] ?? 0) + value;
    if (metric === "messages_in") {
      this.lastMessageInAt = Date.now();
    }
  }

  set(metric: string, value: number): void {
    this.gauges[metric] = value;
  }

  captureError(message: string): void {
    if (this.errors.length >= MAX_ERRORS_PER_FLUSH) return;
    this.errors.push({ message: message.slice(0, 1024), timestamp: new Date().toISOString() });
  }

  private buildPostHogBatch(): Record<string, unknown> {
    const now = Date.now();
    const secondsSince =
      this.lastMessageInAt > 0
        ? Math.round((now - this.lastMessageInAt) / 1000)
        : -1;
    const ts = new Date().toISOString();
    const distinctId = `instance:${this.instanceId}`;

    const batch: Record<string, unknown>[] = [{
      event: "instance_stats",
      distinct_id: distinctId,
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
        environment: this.environment,
        runtime_version: this.version,
        seconds_since_last_message_in: secondsSince,
        $set: {
          agent_name: this.agentName,
          runtime: this.runtime,
          environment: this.environment,
        },
      },
    }];

    for (const err of this.errors) {
      batch.push({
        event: "instance_error",
        distinct_id: distinctId,
        timestamp: err.timestamp,
        properties: {
          schema_version: SCHEMA_VERSION,
          instance_id: this.instanceId,
          runtime: this.runtime,
          environment: this.environment,
          runtime_version: this.version,
          error_message: err.message,
        },
      });
    }

    return { api_key: this.posthogApiKey, batch, sent_at: ts };
  }

  private hasActivity(): boolean {
    return (
      Object.values(this.counters).some((v) => v > 0) ||
      this.errors.length > 0
    );
  }

  flush(): Record<string, unknown> {
    const batch = this.buildPostHogBatch();
    this.counters = {};
    this.errors = [];
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

  private installConsoleErrorHook(): void {
    this.originalConsoleError = console.error;
    const self = this;
    console.error = function (...args: unknown[]) {
      self.originalConsoleError!.apply(console, args);
      try {
        const msg = args.map((a) =>
          typeof a === "string" ? a : a instanceof Error ? a.message : String(a),
        ).join(" ");
        self.captureError(msg);
      } catch {
        // Never break the original console.error path
      }
    };
  }

  private uninstallConsoleErrorHook(): void {
    if (this.originalConsoleError) {
      console.error = this.originalConsoleError;
      this.originalConsoleError = null;
    }
  }

  start(opts: {
    posthogApiKey: string;
    posthogHost?: string;
    instanceId: string;
    agentName?: string;
    runtime?: string;
    environment?: string;
    version?: string;
  }): void {
    if (this.started) return;
    this.posthogApiKey = opts.posthogApiKey;
    this.posthogHost = (opts.posthogHost || "https://us.i.posthog.com").replace(/\/+$/, "");
    this.instanceId = opts.instanceId;
    this.agentName = opts.agentName || "";
    if (opts.runtime) this.runtime = opts.runtime;
    this.environment = opts.environment || "";
    this.version = opts.version || "";
    this.started = true;

    this.installConsoleErrorHook();

    this.timer = setInterval(() => {
      if (!this.hasActivity()) return;
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
    // Snapshot before clearing timer — interval callback may have cleared counters
    const batch = this.flush();
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.uninstallConsoleErrorHook();
    await this.send(batch);
    this.started = false;
    console.log("[stats] shut down (final flush sent)");
  }
}

export const stats = new StatsAccumulator();
