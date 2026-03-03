import metrics from "datadog-metrics";
import { config } from "./config.js";
import { getCounts } from "./db/pool.js";

let isInitialized = false;

export function initMetrics(): void {
  const apiKey = process.env.DATADOG_API_KEY;
  if (!apiKey) {
    console.log("[metrics] DATADOG_API_KEY not set — metrics disabled");
    return;
  }
  metrics.init({
    apiKey,
    prefix: "convos.pool.",
    defaultTags: [`env:${config.poolEnvironment}`],
  });
  isInitialized = true;
  console.log("[metrics] Datadog metrics initialized");

  // Emit pool status gauges every 15s (sequential to avoid stacking on slow DB)
  const emitGauges = () => setTimeout(async () => {
    try {
      const counts = await getCounts();
      for (const [status, count] of Object.entries(counts)) {
        metricGauge(status, count);
      }
    } catch {} finally {
      emitGauges();
    }
  }, 15_000);
  emitGauges();
}

function formatTags(tags: Record<string, string | undefined>): string[] {
  return Object.entries(tags)
    .filter(([, v]) => v != null && String(v).trim() !== "")
    .map(([k, v]) => `${k}:${String(v).trim()}`);
}

/** Increment a counter — use for events (things that happen). */
export function metricCount(
  name: string,
  value: number = 1,
  tags: Record<string, string | undefined> = {},
): void {
  if (!isInitialized) return;
  const formatted = formatTags(tags);
  const tagStr = formatted.length ? ` [${formatted.join(", ")}]` : "";
  console.log(`[dd] ${name} +${value}${tagStr}`);
  metrics.increment(name, value, formatted);
}

/** Record a duration or distribution — use for latencies. */
export function metricHistogram(
  name: string,
  value: number,
  tags: Record<string, string | undefined> = {},
): void {
  if (!isInitialized) return;
  const formatted = formatTags(tags);
  const rounded = Math.round(value);
  const tagStr = formatted.length ? ` [${formatted.join(", ")}]` : "";
  console.log(`[dd] ${name} = ${rounded}${tagStr}`);
  metrics.histogram(name, rounded, formatted);
}

/** Point-in-time value — use for current counts, queue depths, etc. */
export function metricGauge(
  name: string,
  value: number,
  tags: Record<string, string | undefined> = {},
): void {
  if (!isInitialized) return;
  const formatted = formatTags(tags);
  const rounded = Math.round(value);
  if (rounded !== 0) {
    const tagStr = formatted.length ? ` [${formatted.join(", ")}]` : "";
    console.log(`[dd] ${name} = ${rounded}${tagStr}`);
  }
  metrics.gauge(name, rounded, formatted);
}

export function flushMetrics(): Promise<void> {
  if (!isInitialized) return Promise.resolve();
  return new Promise((resolve) => {
    metrics.flush(resolve, resolve);
  });
}
