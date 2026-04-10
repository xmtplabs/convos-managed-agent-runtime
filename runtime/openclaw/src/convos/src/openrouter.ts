/**
 * OpenRouter credit check — used by outbound-policy.ts to detect
 * credit exhaustion masquerading as context-overflow errors.
 */

/** Minimum remaining credit (USD) below which we consider the key exhausted. */
const LOW_CREDIT_THRESHOLD = 0.50;

export async function checkCreditsLow(): Promise<boolean> {
  const instanceId = process.env.INSTANCE_ID;
  const gatewayToken = process.env.GATEWAY_TOKEN;
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
