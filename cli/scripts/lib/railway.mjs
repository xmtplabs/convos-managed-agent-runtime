/**
 * Shared Railway helpers for CLI scripts.
 * Resolves RAILWAY_ENVIRONMENT_NAME → environment ID automatically.
 */

import { isAgentService } from "../../../pool/src/naming.js";

const RAILWAY_API = "https://backboard.railway.com/graphql/v2";

async function gql(token, query, variables = {}) {
  const res = await fetch(RAILWAY_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors) throw new Error(`Railway API error: ${JSON.stringify(body.errors)}`);
  return body.data;
}

/** Resolve RAILWAY_ENVIRONMENT_NAME to an environment ID. Returns null if not set. */
export async function resolveEnvironmentId(token, projectId) {
  const envName = process.env.RAILWAY_ENVIRONMENT_NAME;
  if (!envName) return null;

  const data = await gql(token, `query($id: String!) {
    project(id: $id) {
      environments { edges { node { id name } } }
    }
  }`, { id: projectId });

  const envs = data?.project?.environments?.edges ?? [];
  const match = envs.find((e) => e.node.name.toLowerCase() === envName.toLowerCase());
  if (!match) {
    const available = envs.map((e) => e.node.name).join(", ");
    throw new Error(`Railway environment "${envName}" not found. Available: ${available}`);
  }
  return match.node.id;
}

/** Fetch all convos-agent-* services, optionally filtered by environment name. */
export async function getAgentServices(token, projectId, envId) {
  const data = await gql(token, `query($id: String!) {
    project(id: $id) {
      services(first: 500) {
        edges { node { id name createdAt serviceInstances { edges { node { environmentId } } } } }
      }
    }
  }`, { id: projectId });

  const edges = data?.project?.services?.edges ?? [];
  const results = [];

  for (const { node } of edges) {
    if (!isAgentService(node.name)) continue;
    if (envId) {
      const envIds = (node.serviceInstances?.edges || []).map((e) => e.node.environmentId);
      if (!envIds.includes(envId)) continue;
    }
    results.push(node);
  }
  return results;
}

/** Get a Map of serviceName → service info for all agent services. Key is the full name (e.g. "convos-agent-zyWHCTV2npMp"). */
export async function getAgentServiceMap() {
  const token = process.env.RAILWAY_API_TOKEN;
  const projectId = process.env.RAILWAY_PROJECT_ID;
  if (!token || !projectId) return new Map();

  const envId = await resolveEnvironmentId(token, projectId);
  const services = await getAgentServices(token, projectId, envId);

  const map = new Map();
  for (const svc of services) {
    map.set(svc.name, { serviceId: svc.id, name: svc.name, createdAt: svc.createdAt });
  }
  return map;
}

/** Get a Set of active service names (for clean-providers). */
export async function getActiveServiceNames() {
  const token = process.env.RAILWAY_API_TOKEN;
  const projectId = process.env.RAILWAY_PROJECT_ID;
  if (!token || !projectId) return new Set();

  const envId = await resolveEnvironmentId(token, projectId);
  const services = await getAgentServices(token, projectId, envId);

  return new Set(services.map((svc) => svc.name));
}
