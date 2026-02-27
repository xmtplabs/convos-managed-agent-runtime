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
  metrics.gauge(name, Math.round(value), formatted);
}

export function flushMetrics(): Promise<void> {
  if (!isInitialized) return Promise.resolve();
  return new Promise((resolve) => {
    metrics.flush(resolve, resolve);
  });
}
