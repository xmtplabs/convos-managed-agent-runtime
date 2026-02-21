import { resolveOpenRouterApiKey, deleteOpenRouterKey } from "../keys.js";

export async function resolve(instanceId) {
  const { key, hash } = await resolveOpenRouterApiKey(instanceId);
  return {
    envVars: { OPENROUTER_API_KEY: key },
    cleanupHandle: hash ? { openRouterKeyHash: hash } : null,
  };
}

export async function cleanup(handle, instanceId) {
  if (!handle?.openRouterKeyHash) return;
  await deleteOpenRouterKey(handle.openRouterKeyHash, instanceId);
}
