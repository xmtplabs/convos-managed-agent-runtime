import { config } from "./config.js";

const SERVICE = "convos-pool";
const DD_API_KEY = process.env.DATADOG_API_KEY;
const DD_SITE = process.env.DATADOG_SITE || "datadoghq.com";
const ENV = config.poolEnvironment;
const BRANCH = config.deployBranch;

if (DD_API_KEY) {
  console.log(`[logger] Datadog log forwarding enabled (site=${DD_SITE}, env=${ENV}, branch=${BRANCH})`);
} else {
  console.log("[logger] DATADOG_API_KEY not set — log forwarding disabled");
}

const DD_TAGS = `env:${ENV},branch:${BRANCH}`;

type Level = "info" | "warn" | "error";

function emit(level: Level, message: string, context?: Record<string, unknown>): void {
  const entry = {
    ...context,
    timestamp: new Date().toISOString(),
    level,
    message,
    service: SERVICE,
    ddsource: SERVICE,
    env: ENV,
    branch: BRANCH,
    dd: { service: SERVICE, env: ENV },
  };
  if (DD_API_KEY) {
    fetch(`https://http-intake.logs.${DD_SITE}/api/v2/logs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "DD-API-KEY": DD_API_KEY,
        "ddtags": DD_TAGS,
      },
      body: JSON.stringify([entry]),
    }).catch(() => {});
  }
}

export const logger = {
  info: (message: string, context?: Record<string, unknown>) => emit("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => emit("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => emit("error", message, context),
};

export function classifyError(err: unknown): { error_class: string; error_message: string } {
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message
    : typeof err === "object" && err !== null && "message" in err ? String((err as { message: unknown }).message)
    : String(err);
  const status =
    typeof err === "object" && err !== null && "status" in err
      ? (err as { status: unknown }).status
      : undefined;

  // Timeout / abort
  if (
    name === "AbortError" ||
    name === "TimeoutError" ||
    /timeout|aborted/i.test(message)
  ) {
    return { error_class: "timeout", error_message: message };
  }

  // HTTP status codes
  if (typeof status === "number" && status >= 400) {
    const error_class = status < 500 ? "http_4xx" : "http_5xx";
    return { error_class, error_message: message };
  }
  const statusMatch = message.match(/(?:status|http|response)\D{0,12}\b([45]\d{2})\b/i);
  if (statusMatch) {
    const code = parseInt(statusMatch[1], 10);
    const error_class = code < 500 ? "http_4xx" : "http_5xx";
    return { error_class, error_message: message };
  }

  // Network errors
  if (/fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT/i.test(message) || (name === "TypeError" && /fetch/i.test(message))) {
    return { error_class: "network", error_message: message };
  }

  return { error_class: "unknown", error_message: message };
}
