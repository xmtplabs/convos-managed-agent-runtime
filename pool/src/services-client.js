/**
 * HTTP client for the services API. Pool delegates all provider interactions
 * (Railway, OpenRouter, AgentMail, Telnyx) through this client.
 */

const SERVICES_URL = process.env.SERVICES_URL; // e.g. http://services.railway.internal:3002
const SERVICES_API_KEY = process.env.SERVICES_API_KEY;

async function request(method, path, body = null) {
  if (!SERVICES_URL) throw new Error("SERVICES_URL not set");

  const url = `${SERVICES_URL}${path}`;
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${SERVICES_API_KEY}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(120_000), // 2 min timeout for create/destroy
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Services API ${method} ${path} failed: ${res.status} ${json?.error || JSON.stringify(json)}`);
  }
  return json;
}

/** Create a new instance via services. Returns { instanceId, serviceId, url, gatewayToken, services }. */
export async function createInstance(instanceId, name, tools = ["openrouter", "agentmail"]) {
  return request("POST", "/create-instance", { instanceId, name, tools });
}

/** Destroy an instance and all its resources. Returns { instanceId, destroyed }. */
export async function destroyInstance(instanceId) {
  return request("DELETE", `/destroy/${instanceId}`);
}

/** Fetch deploy status for all agent services. Returns { services: [...] }. */
export async function fetchBatchStatus(instanceIds = null) {
  return request("POST", "/status/batch", instanceIds ? { instanceIds } : {});
}

/** Set env vars on an instance. Returns { instanceId, ok }. */
export async function configureInstance(instanceId, variables, redeploy = false) {
  return request("POST", `/configure/${instanceId}`, { variables, redeploy });
}

/** Redeploy an instance. Returns { instanceId, ok }. */
export async function redeployInstance(instanceId) {
  return request("POST", `/redeploy/${instanceId}`);
}
