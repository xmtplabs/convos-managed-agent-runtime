/**
 * Pre-flight credit check for OpenRouter.
 *
 * When OpenClaw misclassifies a 402 (credit exhaustion) as a context-overflow
 * error, the user sees a confusing "prompt too large" message.  This module
 * lets the outbound path detect that case and rewrite it to a friendly
 * "out of credits" message instead.
 */

const CONTEXT_OVERFLOW_PREFIX = "Context overflow:";

/** Minimum remaining credit (USD) below which we consider the key exhausted. */
const LOW_CREDIT_THRESHOLD = 0.50;

/** Returns true when the text looks like OpenClaw's context-overflow rewrite. */
export function isContextOverflowText(text: string): boolean {
  return text.startsWith(CONTEXT_OVERFLOW_PREFIX);
}

/**
 * Ask the pool server whether this instance's OpenRouter key has credits left.
 * Returns `true` when credits are low / unavailable, `false` otherwise.
 * Silently returns `false` if the env vars are missing or the call fails —
 * in that case we let the original message through unchanged.
 */
export async function checkCreditsLow(): Promise<boolean> {
  const instanceId = process.env.INSTANCE_ID;
  const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;
  const poolUrl = process.env.POOL_URL;
  if (!instanceId || !gatewayToken || !poolUrl) return false;

  try {
    const res = await fetch(`${poolUrl}/api/pool/credits-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceId, gatewayToken }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { remaining?: number };
    return (data.remaining ?? Infinity) < LOW_CREDIT_THRESHOLD;
  } catch {
    return false;
  }
}

/** Build the user-facing "out of credits" message with a top-up link. */
export function buildCreditErrorMessage(): string {
  const domain = process.env.RAILWAY_PUBLIC_DOMAIN;
  const ngrok = process.env.NGROK_URL;
  const port = process.env.POOL_SERVER_PORT || process.env.PORT || "18789";
  const base = domain
    ? `https://${domain}`
    : ngrok
      ? ngrok.replace(/\/$/, "")
      : `http://127.0.0.1:${port}`;
  return `Hey! I'm out of credits. You can top up here: ${base}/web-tools/services`;
}
