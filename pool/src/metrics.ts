import metrics from "datadog-metrics";
import { config } from "./config.js";

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
}

export function sendMetric(
  name: string,
  value: number,
  tags: Record<string, string | undefined> = {},
): void {
  if (!isInitialized) return;
  const formatted = Object.entries(tags)
    .filter(([, v]) => v != null && String(v).trim() !== "")
    .map(([k, v]) => `${k}:${String(v).trim()}`);
  const rounded = Math.round(value);
  if (rounded !== 0) {
    const tagStr = formatted.length ? ` [${formatted.join(", ")}]` : "";
    console.log(`[dd] ${name} = ${rounded}${tagStr}`);
  }
  metrics.gauge(name, rounded, formatted);
}

/** Send multiple metrics and log a single summary line instead of one per metric. */
export function sendMetricBatch(
  label: string,
  batch: Array<[name: string, value: number, tags?: Record<string, string | undefined>]>,
): void {
  if (!isInitialized) return;
  const parts: string[] = [];
  for (const [name, value, tags] of batch) {
    const formatted = Object.entries(tags || {})
      .filter(([, v]) => v != null && String(v).trim() !== "")
      .map(([k, v]) => `${k}:${String(v).trim()}`);
    const rounded = Math.round(value);
    metrics.gauge(name, rounded, formatted);
    if (rounded !== 0) parts.push(`${name}=${rounded}`);
  }
  if (parts.length) console.log(`[dd] ${label}: ${parts.join(", ")}`);
}

export function flushMetrics(): Promise<void> {
  if (!isInitialized) return Promise.resolve();
  return new Promise((resolve) => {
    metrics.flush(resolve, resolve);
  });
}
