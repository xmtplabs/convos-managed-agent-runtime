/**
 * Outbound text policy — rewrite or suppress agent text before sending to users.
 *
 * Rules loaded from convos-platform/outbound-policy.json so both runtimes
 * share the same patterns, thresholds, and messages.
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname, join } from "path";
import { checkCreditsLow } from "./openrouter.js";

type OutboundTextPolicyResult = {
  suppress: boolean;
  text: string;
};

// ── Anchor-based root resolution (#816) ─────────────────────────────────

/** Walk up from *start* to find the nearest directory containing *marker*. */
function findAncestor(start: string, marker: string): string | null {
  let dir = resolve(start);
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, marker))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const PLATFORM_ROOT = findAncestor(__dirname, "convos-platform") || "/app";

// ── Load shared policy ──────────────────────────────────────────────────

const POLICY_PATHS = [
  join(PLATFORM_ROOT, "convos-platform", "outbound-policy.json"),
];

let policy: Record<string, any> = {};
for (const p of POLICY_PATHS) {
  if (existsSync(p)) {
    policy = JSON.parse(readFileSync(p, "utf-8"));
    break;
  }
}

const OVERLOADED_PATTERNS: string[] = policy.overloadedPatterns ?? [];
const RATE_LIMIT_PATTERNS: string[] = policy.rateLimitPatterns ?? [];
const CREDIT_PATTERNS: string[] = policy.creditPatterns ?? [];
const CONTEXT_OVERFLOW_PREFIX: string = policy.contextOverflowPrefix ?? "Context overflow:";
const SUPPRESS_TOKENS: Set<string> = new Set(policy.suppressTokens ?? []);
const CREDIT_MSG_TEMPLATE: string = policy.creditMessageTemplate ?? "Hey! I'm out of credits. You can top up here: {{servicesUrl}}";

// ── Helpers ─────────────────────────────────────────────────────────────

function isOverloadedText(text: string): boolean {
  const lower = text.toLowerCase();
  return OVERLOADED_PATTERNS.some((p) => lower.includes(p));
}

function isRateLimited(text: string): boolean {
  const lower = text.toLowerCase();
  return RATE_LIMIT_PATTERNS.some((p) => lower.includes(p));
}

function isCreditError(text: string): boolean {
  const lower = text.toLowerCase();
  return CREDIT_PATTERNS.some((p) => lower.includes(p));
}

function buildCreditMessage(): string {
  const domain = process.env.RAILWAY_PUBLIC_DOMAIN;
  const ngrok = process.env.NGROK_URL;
  const port = process.env.POOL_SERVER_PORT || process.env.PORT || "18789";
  const base = domain
    ? `https://${domain}`
    : ngrok
      ? ngrok.replace(/\/$/, "")
      : `http://127.0.0.1:${port}`;
  return CREDIT_MSG_TEMPLATE.replace("{{servicesUrl}}", `${base}/web-tools/services`);
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Strip lines that consist solely of a suppress token (e.g. SILENT, HEARTBEAT_OK).
 * Handles markdown-wrapped variants like **SILENT**, `SILENT`, etc.
 */
export function stripSuppressLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const bare = line.trim().replace(/[\*_`~]+/g, "");
      return !SUPPRESS_TOKENS.has(bare);
    })
    .join("\n")
    .trim();
}

export async function applyOutboundTextPolicy(text: string): Promise<OutboundTextPolicyResult> {
  // Strip suppress-token lines (e.g. SILENT, HEARTBEAT_OK).
  // If real content remains, deliver it.  Only suppress when nothing is left.
  const cleaned = stripSuppressLines(text);
  if (!cleaned) {
    return { suppress: true, text: "" };
  }

  // Rate-limit check BEFORE credit check — "rate limit exceeded" contains
  // the substring "limit exceeded" which would false-positive on creditPatterns.
  if (isRateLimited(cleaned)) {
    return { suppress: true, text: "" };
  }

  if (isCreditError(cleaned)) {
    return { suppress: false, text: buildCreditMessage() };
  }

  if (cleaned.startsWith(CONTEXT_OVERFLOW_PREFIX) && await checkCreditsLow()) {
    return { suppress: false, text: buildCreditMessage() };
  }

  if (isOverloadedText(cleaned)) {
    return { suppress: true, text: "" };
  }

  return { suppress: false, text: cleaned };
}
