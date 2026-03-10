/**
 * authFetch — fetch wrapper with legacy POOL_API_KEY fallback.
 *
 * New instances authenticate pool-manager requests via their per-instance
 * OPENCLAW_GATEWAY_TOKEN. Old instances (deployed before the token unification)
 * still expect the shared POOL_API_KEY.
 *
 * This helper tries the per-instance gatewayToken first. If the instance
 * responds with 401, it retries once with config.poolApiKey as a fallback
 * so existing instances keep working during the transition.
 *
 * TODO: Remove the fallback once all running instances have been redeployed
 *       with the unified token auth (no more POOL_API_KEY on the runtime).
 */

import { config } from "./config";

interface AuthFetchOpts extends RequestInit {
  /** Per-instance gateway token (preferred). */
  gatewayToken?: string | null;
}

/**
 * Fetch with per-instance token, falling back to shared POOL_API_KEY on 401.
 * Returns the Response object. Caller is responsible for checking res.ok.
 */
export async function authFetch(url: string, opts: AuthFetchOpts = {}): Promise<Response> {
  const { gatewayToken, ...fetchOpts } = opts;

  // Build headers with per-instance token
  const headers = new Headers(fetchOpts.headers);
  if (gatewayToken) {
    headers.set("Authorization", `Bearer ${gatewayToken}`);
  }

  const res = await fetch(url, { ...fetchOpts, headers });

  // Legacy fallback: if 401 and we have a shared POOL_API_KEY, retry with it.
  // Old instances check POOL_API_KEY instead of OPENCLAW_GATEWAY_TOKEN.
  if (res.status === 401 && config.poolApiKey && config.poolApiKey !== gatewayToken) {
    headers.set("Authorization", `Bearer ${config.poolApiKey}`);
    return fetch(url, { ...fetchOpts, headers });
  }

  return res;
}
