import { config } from "../../config";

const RAILWAY_API = "https://backboard.railway.com/graphql/v2";

export async function gql(query: string, variables: Record<string, unknown> = {}): Promise<Record<string, any>> {
  const token = config.railwayApiToken;
  if (!token) throw new Error("RAILWAY_API_TOKEN not set");

  const res = await fetch(RAILWAY_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Railway API error: ${res.status}${res.status === 429 ? " (rate limited — wait a few minutes)" : ""}`);
  }
  if (json.errors) {
    throw new Error(`Railway API error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

function getEnvironmentId(): string {
  const envId = config.railwayEnvironmentId || process.env.RAILWAY_ENVIRONMENT_ID;
  if (!envId) throw new Error("RAILWAY_ENVIRONMENT_ID not set");
  return envId;
}

export async function createService(name: string, variables: Record<string, string> = {}): Promise<string> {
  const projectId = config.railwayProjectId;
  const environmentId = getEnvironmentId();
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
    });
    console.log(`[railway]   Configured: image=${image}`);
  } catch (err: any) {
    console.warn(`[railway] Failed to configure service instance for ${serviceId}:`, err);
  }

  // Set resource limits
  await setResourceLimits(serviceId);

  // Upsert variables with skipDeploys
  if (Object.keys(variables).length > 0) {
    await upsertVariables(serviceId, variables, { skipDeploys: true });
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
): Promise<void> {
  const projectId = config.railwayProjectId;
  const environmentId = getEnvironmentId();

  await gql(
    `mutation($input: VariableCollectionUpsertInput!) {
      variableCollectionUpsert(input: $input)
    }`,
    { input: { projectId, environmentId, serviceId, variables, skipDeploys } },
  );
}

export async function createDomain(serviceId: string): Promise<string> {
  const environmentId = getEnvironmentId();

  const data = await gql(
    `mutation($input: ServiceDomainCreateInput!) {
      serviceDomainCreate(input: $input) { domain }
    }`,
    { input: { serviceId, environmentId } },
  );

  return data.serviceDomainCreate.domain;
}

export async function updateServiceInstance(serviceId: string, settings: Record<string, unknown> = {}): Promise<void> {
  const environmentId = getEnvironmentId();

  await gql(
    `mutation($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
      serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
    }`,
    { serviceId, environmentId, input: settings },
  );
}

export async function redeployService(serviceId: string): Promise<void> {
  const environmentId = getEnvironmentId();
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
  { cpu = 4, memoryGB = 8 } = {},
): Promise<void> {
  const environmentId = getEnvironmentId();
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

export async function createVolume(serviceId: string, mountPath = "/data"): Promise<{ id: string; name: string }> {
  const projectId = config.railwayProjectId;
  const environmentId = getEnvironmentId();

  const data = await gql(
    `mutation($input: VolumeCreateInput!) {
      volumeCreate(input: $input) { id name }
    }`,
    { input: { projectId, serviceId, mountPath, environmentId } },
  );

  return data.volumeCreate;
}

/** Try to create a volume for a service. Returns true on success. */
export async function ensureVolume(serviceId: string): Promise<boolean> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const vol = await createVolume(serviceId, "/data");
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
export async function fetchAllVolumesByService(): Promise<Map<string, string[]> | null> {
  const projectId = config.railwayProjectId;
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
      { id: projectId },
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

/** List all services in the project with environment info, deploy status, domains, and images. */
export async function listProjectServices(): Promise<ListedService[] | null> {
  const projectId = config.railwayProjectId;
  const envId = getEnvironmentId();
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
      { id: projectId },
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

/** Resolve RAILWAY_ENVIRONMENT_ID from RAILWAY_ENVIRONMENT_NAME if only the name is set. */
export async function resolveEnvironmentId(): Promise<string> {
  if (config.railwayEnvironmentId || process.env.RAILWAY_ENVIRONMENT_ID) {
    return config.railwayEnvironmentId || process.env.RAILWAY_ENVIRONMENT_ID!;
  }

  const name = config.railwayEnvironmentName;
  if (!name) throw new Error("Neither RAILWAY_ENVIRONMENT_ID nor RAILWAY_ENVIRONMENT_NAME is set");

  const projectId = config.railwayProjectId;
  const data = await gql(
    `query($id: String!) {
      project(id: $id) {
        environments { edges { node { id name } } }
      }
    }`,
    { id: projectId },
  );

  const envs = data.project?.environments?.edges || [];
  const match = envs.find((e: any) => e.node.name.toLowerCase() === name.toLowerCase());
  if (!match) {
    const available = envs.map((e: any) => e.node.name).join(", ");
    throw new Error(`Environment "${name}" not found. Available: ${available}`);
  }

  // Cache it
  process.env.RAILWAY_ENVIRONMENT_ID = match.node.id;
  console.log(`[railway] Resolved environment "${name}" → ${match.node.id}`);
  return match.node.id;
}
