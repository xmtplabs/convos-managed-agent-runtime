import { config } from "../../config.js";

/** Create an OpenRouter API key via management API. Returns { key, hash }. */
export async function createKey(name: string, limit?: number): Promise<{ key: string; hash: string }> {
  const mgmtKey = config.openrouterManagementKey;
  if (!mgmtKey) throw new Error("OPENROUTER_MANAGEMENT_KEY not set");

  const keyLimit = limit ?? config.openrouterKeyLimit;
  const limitReset = config.openrouterKeyLimitReset;

  const res = await fetch("https://openrouter.ai/api/v1/keys", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${mgmtKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, limit: keyLimit, limit_reset: limitReset }),
  });
  const body = await res.json() as any;
  const key = body?.key;
  const hash = body?.data?.hash ?? null;
  if (!key) {
    console.error("[openrouter] Create key failed:", res.status, body);
    throw new Error(`OpenRouter key creation failed: ${res.status}`);
  }
  console.log(`[openrouter] Created key for ${name} (hash=${hash})`);
  return { key, hash };
}

/** Delete an OpenRouter API key by hash. Best-effort. */
export async function deleteKey(hash: string): Promise<boolean> {
  const mgmtKey = config.openrouterManagementKey;
  if (!mgmtKey || !hash) return false;

  try {
    const res = await fetch(`https://openrouter.ai/api/v1/keys/${hash}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${mgmtKey}` },
    });
    if (res.ok) {
      console.log(`[openrouter] Deleted key (hash=${hash})`);
      return true;
    }
    const body = await res.text();
    console.warn(`[openrouter] Failed to delete key (hash=${hash}): ${res.status} ${body}`);
    return false;
  } catch (err: any) {
    console.warn(`[openrouter] Failed to delete key (hash=${hash}):`, err.message);
    return false;
  }
}

/** Get account-level credits from OpenRouter. */
export async function getCredits(): Promise<{ totalCredits: number; totalUsage: number }> {
  const mgmtKey = config.openrouterManagementKey;
  if (!mgmtKey) throw new Error("OPENROUTER_MANAGEMENT_KEY not set");

  const res = await fetch("https://openrouter.ai/api/v1/credits", {
    headers: { Authorization: `Bearer ${mgmtKey}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter credits request failed: ${res.status} ${body}`);
  }
  const body = await res.json() as any;
  return {
    totalCredits: body?.data?.total_credits ?? 0,
    totalUsage: body?.data?.total_usage ?? 0,
  };
}

/** List all provisioned API keys with usage info. */
export async function listKeys(): Promise<any[]> {
  const mgmtKey = config.openrouterManagementKey;
  if (!mgmtKey) throw new Error("OPENROUTER_MANAGEMENT_KEY not set");

  const res = await fetch("https://openrouter.ai/api/v1/keys", {
    headers: { Authorization: `Bearer ${mgmtKey}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter list keys failed: ${res.status} ${body}`);
  }
  const body = await res.json() as any;
  return body?.data ?? [];
}

/** Lookup an OpenRouter key hash by name. Returns hash or null. */
export async function findKeyHash(name: string): Promise<string | null> {
  const mgmtKey = config.openrouterManagementKey;
  if (!mgmtKey) return null;

  try {
    const res = await fetch("https://openrouter.ai/api/v1/keys", {
      headers: { Authorization: `Bearer ${mgmtKey}` },
    });
    if (!res.ok) return null;
    const body = await res.json() as any;
    const keys: any[] = body?.data ?? [];
    const match = keys.find((k) => k.name === name);
    return match?.hash ?? null;
  } catch {
    return null;
  }
}
