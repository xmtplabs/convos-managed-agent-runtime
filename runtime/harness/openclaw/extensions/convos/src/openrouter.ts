/**
 * OpenRouter credit check — used by outbound-policy.ts to detect
 * credit exhaustion masquerading as context-overflow errors.
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
    const threshold = parseFloat(process.env.LOW_CREDIT_THRESHOLD || "0.50");
    return (data.remaining ?? Infinity) < threshold;
  } catch {
    return false;
  }
}
