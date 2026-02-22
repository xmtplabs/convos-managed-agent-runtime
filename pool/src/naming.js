/**
 * Centralized naming helpers for convos-agent services.
 *
 * All service-name construction, filtering, and parsing should go through
 * these helpers so the naming convention lives in exactly one place.
 */

export const AGENT_PREFIX = "convos-agent-";

const POOL_MANAGER = "convos-agent-pool-manager";

function envSuffix() {
  return process.env.RAILWAY_ENVIRONMENT_NAME || "staging";
}

/** Build the canonical service name for an instance. */
export function serviceName(instanceId) {
  return `${AGENT_PREFIX}${instanceId}-${envSuffix()}`;
}

/** True if `name` looks like an agent service (not the pool-manager). */
export function isAgentService(name) {
  return name.startsWith(AGENT_PREFIX) && name !== POOL_MANAGER;
}

/**
 * Extract the instanceId from a service name.
 * Handles both old (`convos-agent-<id>`) and new (`convos-agent-<id>-<env>`) formats.
 */
export function parseInstanceId(name) {
  if (!name.startsWith(AGENT_PREFIX)) return name;
  const rest = name.slice(AGENT_PREFIX.length);
  // Strip known env suffix if present (e.g. "-staging", "-production")
  const env = envSuffix();
  if (rest.endsWith(`-${env}`)) {
    return rest.slice(0, -(env.length + 1));
  }
  return rest;
}
