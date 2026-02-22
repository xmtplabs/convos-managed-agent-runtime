/**
 * Centralized naming helpers for convos-agent services.
 *
 * All service-name construction, filtering, and parsing should go through
 * these helpers so the naming convention lives in exactly one place.
 */

export const AGENT_PREFIX = "convos-agent-";

const POOL_MANAGER = "convos-agent-pool-manager";

/** Build the canonical service name for an instance. */
export function serviceName(instanceId) {
  return `${AGENT_PREFIX}${instanceId}`;
}

/** True if `name` looks like an agent service (not the pool-manager). */
export function isAgentService(name) {
  return name.startsWith(AGENT_PREFIX) && name !== POOL_MANAGER;
}

/** Extract the instanceId from a service name. */
export function parseInstanceId(name) {
  if (!name.startsWith(AGENT_PREFIX)) return name;
  return name.slice(AGENT_PREFIX.length);
}
