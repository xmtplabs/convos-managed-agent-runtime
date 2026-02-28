import { config } from "../../config";

const RAILWAY_API = "https://backboard.railway.com/graphql/v2";

const GQL_MAX_RETRIES = 3;
const GQL_BASE_DELAY_MS = 2000;

export async function gql(query: string, variables: Record<string, unknown> = {}): Promise<Record<string, any>> {
  const token = config.railwayApiToken;
  if (!token) throw new Error("RAILWAY_API_TOKEN not set");

  for (let attempt = 1; attempt <= GQL_MAX_RETRIES; attempt++) {
    const res = await fetch(RAILWAY_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (res.status === 429 && attempt < GQL_MAX_RETRIES) {
      const delay = GQL_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.warn(`[railway] 429 rate limited — retry ${attempt}/${GQL_MAX_RETRIES} in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Railway API error: ${res.status}${res.status === 429 ? " (rate limited)" : ""}`);
    }
    if (json.errors) {
      throw new Error(`Railway API error: ${JSON.stringify(json.errors)}`);
    }
    return json.data;
  }

  throw new Error("Railway API: exhausted retries (should not reach here)");
}

// ── Helpers ────────────────────────────────────────────────────────────────────

interface ProjectEnvOpts {
  projectId?: string;
  environmentId?: string;
}

function resolveProjectId(opts?: ProjectEnvOpts): string {
  const id = opts?.projectId;
  if (!id) throw new Error("projectId is required");
  return id;
}

function resolveEnvironmentId(opts?: ProjectEnvOpts): string {
  const id = opts?.environmentId;
  if (!id) throw new Error("environmentId is required");
  return id;
}

// ── Project lifecycle (sharding) ──────────────────────────────────────────────

/** Create a new Railway project in the team. Returns { projectId }. */
export async function projectCreate(name: string, teamId?: string): Promise<{ projectId: string }> {
  const tid = teamId || config.railwayTeamId;
  if (!tid) throw new Error("RAILWAY_TEAM_ID not set — required for sharded project creation");

  const data = await gql(
    `mutation($input: ProjectCreateInput!) {
      projectCreate(input: $input) { id }
    }`,
    { input: { name, workspaceId: tid } },
  );

  const projectId = data.projectCreate.id;
  console.log(`[railway] Created project "${name}" → ${projectId}`);
  return { projectId };
}

/** Delete an entire Railway project (cascades services, volumes). */
export async function projectDelete(projectId: string): Promise<void> {
  await gql(
    `mutation($id: String!) {
      projectDelete(id: $id)
    }`,
    { id: projectId },
  );
  console.log(`[railway] Deleted project ${projectId}`);
}

/** Get the default environment ID for a newly created project. */
export async function getProjectEnvironmentId(projectId: string): Promise<string> {
  const data = await gql(
    `query($id: String!) {
      project(id: $id) {
        environments { edges { node { id name } } }
      }
    }`,
    { id: projectId },
  );

  const envs = data.project?.environments?.edges || [];
  if (envs.length === 0) throw new Error(`No environments found in project ${projectId}`);

  // Prefer "production" env, fall back to first
  const prod = envs.find((e: any) => e.node.name.toLowerCase() === "production");
  const env = prod || envs[0];
  console.log(`[railway] Resolved environment for project ${projectId}: "${env.node.name}" → ${env.node.id}`);
  return env.node.id;
}

/** Fetch status of a single service by ID (for DB-driven status checks). */
export async function fetchServiceStatus(
  serviceId: string,
  environmentId?: string,
): Promise<{
  deployStatus: string | null;
  domain: string | null;
  image: string | null;
} | null> {
  const envId = environmentId;
  try {
    const data = await gql(
      `query($id: String!) {
        service(id: $id) {
          serviceInstances {
            edges {
              node {
                environmentId
                domains { serviceDomains { domain } customDomains { domain } }
                source { image }
              }
            }
          }
          deployments(first: 1) {
            edges { node { id status } }
          }
        }
      }`,
      { id: serviceId },
    );

    const svc = data.service;
    if (!svc) return null;

    const instances = svc.serviceInstances?.edges || [];
    const myInstance = envId
      ? instances.find((si: any) => si.node.environmentId === envId)
      : instances[0];

    const domainData = myInstance?.node?.domains;
    const domain = domainData?.customDomains?.[0]?.domain
      || domainData?.serviceDomains?.[0]?.domain
      || null;

    return {
      deployStatus: svc.deployments?.edges?.[0]?.node?.status || null,
      domain,
      image: myInstance?.node?.source?.image || null,
    };
  } catch (err: any) {
    console.warn(`[railway] fetchServiceStatus(${serviceId}) failed: ${err.message}`);
    return null;
  }
}

// ── Service CRUD (parameterized) ──────────────────────────────────────────────

export async function createService(
  name: string,
  variables: Record<string, string> = {},
  opts?: ProjectEnvOpts,
): Promise<string> {
  const projectId = resolveProjectId(opts);
  const environmentId = resolveEnvironmentId(opts);
  const image = config.railwayRuntimeImage;

  const input = { projectId, environmentId, name };
  console.log(`[railway] createService: ${name}, image=${image}, env=${environmentId}`);

  const data = await gql(
    `mutation($input: ServiceCreateInput!) {
      serviceCreate(input: $input) { id }
    }`,
    { input },
  );

  const serviceId = data.serviceCreate.id;

  // Set image + start command before variables
  try {
    await updateServiceInstance(serviceId, {
      startCommand: "node scripts/pool-server",
      source: { image },
    }, opts);
    console.log(`[railway]   Configured: image=${image}`);
  } catch (err: any) {
    console.warn(`[railway] Failed to configure service instance for ${serviceId}:`, err);
  }

  // Set resource limits
  await setResourceLimits(serviceId, undefined, opts);

  // Upsert variables with skipDeploys
  if (Object.keys(variables).length > 0) {
    await upsertVariables(serviceId, variables, { skipDeploys: true }, opts);
  }

  return serviceId;
}

export async function deleteService(serviceId: string): Promise<void> {
  await gql(
    `mutation($id: String!) {
      serviceDelete(id: $id)
    }`,
    { id: serviceId },
  );
}

export async function upsertVariables(
  serviceId: string,
  variables: Record<string, string>,
  { skipDeploys = false } = {},
  opts?: ProjectEnvOpts,
): Promise<void> {
  const projectId = resolveProjectId(opts);
  const environmentId = resolveEnvironmentId(opts);

  await gql(
    `mutation($input: VariableCollectionUpsertInput!) {
      variableCollectionUpsert(input: $input)
    }`,
    { input: { projectId, environmentId, serviceId, variables, skipDeploys } },
  );
}

export async function createDomain(serviceId: string, opts?: ProjectEnvOpts): Promise<string> {
  const environmentId = resolveEnvironmentId(opts);

  const data = await gql(
    `mutation($input: ServiceDomainCreateInput!) {
      serviceDomainCreate(input: $input) { domain }
    }`,
    { input: { serviceId, environmentId } },
  );

  return data.serviceDomainCreate.domain;
}

export async function updateServiceInstance(
  serviceId: string,
  settings: Record<string, unknown> = {},
  opts?: ProjectEnvOpts,
): Promise<void> {
  const environmentId = resolveEnvironmentId(opts);

  await gql(
    `mutation($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
      serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
    }`,
    { serviceId, environmentId, input: settings },
  );
}

export async function redeployService(serviceId: string, opts?: ProjectEnvOpts): Promise<void> {
  const environmentId = resolveEnvironmentId(opts);
  const data = await gql(
    `query($id: String!) {
      service(id: $id) {
        deployments(first: 1) { edges { node { id } } }
      }
    }`,
    { id: serviceId },
  );
  const latestDeploy = data.service?.deployments?.edges?.[0]?.node;
  if (!latestDeploy) throw new Error("No deployment found to redeploy");
  await gql(
    `mutation($id: String!, $environmentId: String!) {
      deploymentRedeploy(id: $id, environmentId: $environmentId)
    }`,
    { id: latestDeploy.id, environmentId },
  );
}

export async function setResourceLimits(
  serviceId: string,
  limits?: { cpu?: number; memoryGB?: number },
  opts?: ProjectEnvOpts,
): Promise<void> {
  const { cpu = 4, memoryGB = 8 } = limits || {};
  const environmentId = resolveEnvironmentId(opts);
  try {
    await gql(
      `mutation($environmentId: String!, $patch: EnvironmentConfig!, $commitMessage: String) {
        environmentPatchCommit(environmentId: $environmentId, patch: $patch, commitMessage: $commitMessage)
      }`,
      {
        environmentId,
        patch: {
          services: {
            [serviceId]: {
              deploy: {
                limitOverride: {
                  containers: {
                    cpu,
                    memoryBytes: memoryGB * 1024 * 1024 * 1024,
                  },
                },
              },
            },
          },
        },
        commitMessage: `Set resource limits: ${cpu} vCPU, ${memoryGB} GB RAM`,
      },
    );
    console.log(`[railway] Set limits: ${cpu} vCPU, ${memoryGB} GB RAM`);
  } catch (err: any) {
    console.warn(`[railway] Failed to set limits for ${serviceId}: ${err.message}`);
  }
}

export async function createVolume(
  serviceId: string,
  mountPath = "/data",
  opts?: ProjectEnvOpts,
): Promise<{ id: string; name: string }> {
  const projectId = resolveProjectId(opts);
  const environmentId = resolveEnvironmentId(opts);

  const data = await gql(
    `mutation($input: VolumeCreateInput!) {
      volumeCreate(input: $input) { id name }
    }`,
    { input: { projectId, serviceId, mountPath, environmentId } },
  );

  return data.volumeCreate;
}

/** Try to create a volume for a service. Returns true on success. */
export async function ensureVolume(
  serviceId: string,
  mountPath = "/data",
  opts?: ProjectEnvOpts,
): Promise<boolean> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const vol = await createVolume(serviceId, mountPath, opts);
      console.log(`[railway] Created volume: ${vol.id}`);
      return true;
    } catch (err: any) {
      console.warn(`[railway] Volume attempt ${attempt}/3 failed for ${serviceId}:`, err.message);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return false;
}

/** Fetch all project volumes grouped by serviceId. */
export async function fetchAllVolumesByService(projectId: string): Promise<Map<string, string[]> | null> {
  const pid = projectId;
  try {
    const data = await gql(
      `query($id: String!) {
        project(id: $id) {
          volumes {
            edges {
              node {
                id
                volumeInstances { edges { node { serviceId } } }
              }
            }
          }
        }
      }`,
      { id: pid },
    );
    const map = new Map<string, string[]>();
    for (const edge of data.project?.volumes?.edges || []) {
      const vol = edge.node;
      for (const vi of vol.volumeInstances?.edges || []) {
        const sid = vi.node?.serviceId;
        if (sid) {
          if (!map.has(sid)) map.set(sid, []);
          map.get(sid)!.push(vol.id);
        }
      }
    }
    return map;
  } catch (err: any) {
    console.warn(`[railway] fetchAllVolumesByService failed: ${err.message}`);
    return null;
  }
}

/** Delete a single volume by ID. Retries up to 3 times with backoff. */
export async function deleteVolume(volumeId: string, serviceId: string): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await gql(`mutation($volumeId: String!) { volumeDelete(volumeId: $volumeId) }`, { volumeId });
      console.log(`[railway] Deleted volume ${volumeId} (was attached to ${serviceId})`);
      return;
    } catch (err: any) {
      console.warn(`[railway] Failed to delete volume ${volumeId} (attempt ${attempt}/3): ${err.message}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

interface ListedService {
  id: string;
  name: string;
  createdAt: string;
  environmentIds: string[];
  deployStatus: string | null;
  domain: string | null;
  image: string | null;
}

/** List all services in a project with environment info, deploy status, domains, and images. */
export async function listProjectServices(projectId: string, environmentId?: string): Promise<ListedService[] | null> {
  const pid = projectId;
  const envId = environmentId;
  try {
    const data = await gql(
      `query($id: String!) {
        project(id: $id) {
          services(first: 500) {
            edges {
              node {
                id
                name
                createdAt
                serviceInstances {
                  edges {
                    node {
                      environmentId
                      domains { serviceDomains { domain } customDomains { domain } }
                      source { image }
                    }
                  }
                }
                deployments(first: 1) {
                  edges { node { id status } }
                }
              }
            }
          }
        }
      }`,
      { id: pid },
    );
    const edges = data.project?.services?.edges;
    if (!edges) return null;
    return edges.map((e: any) => {
      const instances = e.node.serviceInstances?.edges || [];
      const myInstance = envId
        ? instances.find((si: any) => si.node.environmentId === envId)
        : instances[0];
      const domainData = myInstance?.node?.domains;
      const domain = domainData?.customDomains?.[0]?.domain
        || domainData?.serviceDomains?.[0]?.domain
        || null;
      return {
        id: e.node.id,
        name: e.node.name,
        createdAt: e.node.createdAt,
        environmentIds: instances.map((si: any) => si.node.environmentId),
        deployStatus: e.node.deployments?.edges?.[0]?.node?.status || null,
        domain,
        image: myInstance?.node?.source?.image || null,
      };
    });
  } catch (err: any) {
    console.warn(`[railway] listProjectServices failed: ${err.message}`);
    return null;
  }
}

