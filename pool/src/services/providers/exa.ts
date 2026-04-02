import { config } from "../../config";

const EXA_ADMIN_BASE = "https://admin-api.exa.ai/team-management/api-keys";

function headers(): Record<string, string> {
  const key = config.exaServiceKey;
  if (!key) throw new Error("EXA_SERVICE_KEY not set");
  return { "x-api-key": key, "Content-Type": "application/json" };
}

/** Create an Exa API key via the team management API. The key `id` IS the API key. */
export async function createKey(name: string, rateLimit?: number): Promise<{ id: string }> {
  const limit = rateLimit ?? config.exaKeyRateLimit;

  const res = await fetch(EXA_ADMIN_BASE, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ name, rateLimit: limit }),
  });
  const body = (await res.json()) as any;
  const id = body?.apiKey?.id;
  if (!id) {
    console.error("[exa] Create key failed:", res.status, body);
    throw new Error(`Exa key creation failed: ${res.status}`);
  }
  console.log(`[exa] Created key for ${name} (id=${id}, rateLimit=${limit})`);
  return { id };
}

/** Delete an Exa API key by id. Best-effort. */
export async function deleteKey(id: string): Promise<boolean> {
  const key = config.exaServiceKey;
  if (!key || !id) return false;

  try {
    const res = await fetch(`${EXA_ADMIN_BASE}/${id}`, {
      method: "DELETE",
      headers: { "x-api-key": key },
    });
    if (res.ok) {
      console.log(`[exa] Deleted key (id=${id})`);
      return true;
    }
    const body = await res.text();
    console.warn(`[exa] Failed to delete key (id=${id}): ${res.status} ${body}`);
    return false;
  } catch (err: any) {
    console.warn(`[exa] Failed to delete key (id=${id}):`, err.message);
    return false;
  }
}

/** List all Exa API keys for the team. */
export async function listKeys(): Promise<any[]> {
  const res = await fetch(EXA_ADMIN_BASE, { headers: headers() });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Exa list keys failed: ${res.status} ${body}`);
  }
  const body = (await res.json()) as any;
  return body?.apiKeys ?? [];
}

/** Count total provisioned Exa API keys. */
export async function countKeys(): Promise<number> {
  const key = config.exaServiceKey;
  if (!key) return 0;
  try {
    const keys = await listKeys();
    return keys.length;
  } catch {
    return 0;
  }
}
