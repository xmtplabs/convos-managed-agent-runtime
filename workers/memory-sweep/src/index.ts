const RAILWAY_API = "https://backboard.railway.com/graphql/v2";
const SERVICE_PREFIX = "assistant-";

export interface Env {
  STATS_MEMORY: KVNamespace;
  POSTHOG_API_KEY: string;
  RAILWAY_API_TOKEN: string;
  RAILWAY_TEAM_ID: string;
  POSTHOG_HOST?: string;
}

// ── Railway GraphQL client ──────────────────────────────────────────────────

async function railwayGql(
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<Record<string, any>> {
  const res = await fetch(RAILWAY_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Railway API: ${res.status}`);
  const json = (await res.json()) as any;
  if (json.errors) throw new Error(`Railway API: ${JSON.stringify(json.errors)}`);
  return json.data;
}

// ── Service name parsing ────────────────────────────────────────────────────

// Service names follow: assistant-<environment>-<instanceId>
function parseServiceName(name: string): { instanceId: string; environment: string } | null {
  if (!name.startsWith(SERVICE_PREFIX)) return null;
  const rest = name.slice(SERVICE_PREFIX.length);
  const dashIdx = rest.indexOf("-");
  if (dashIdx === -1) return null;
  const environment = rest.slice(0, dashIdx);
  const instanceId = rest.slice(dashIdx + 1);
  return instanceId ? { instanceId, environment } : null;
}

// ── Service discovery ───────────────────────────────────────────────────────

interface ServiceInfo {
  serviceId: string;
  environmentId: string;
  instanceId: string;
  environment: string;
}

async function listTeamServices(token: string, teamId: string): Promise<ServiceInfo[]> {
  const projectData = await railwayGql(
    token,
    `query($teamId: String!) {
      team(id: $teamId) {
        projects { edges { node { id } } }
      }
    }`,
    { teamId },
  );

  const projects = projectData.team?.projects?.edges || [];
  const services: ServiceInfo[] = [];

  for (const proj of projects) {
    const projectId = proj.node.id;
    const svcData = await railwayGql(
      token,
      `query($id: String!) {
        project(id: $id) {
          services(first: 500) {
            edges {
              node {
                id
                name
                serviceInstances {
                  edges { node { environmentId } }
                }
              }
            }
          }
        }
      }`,
      { id: projectId },
    );

    for (const edge of svcData.project?.services?.edges || []) {
      const parsed = parseServiceName(edge.node.name);
      if (!parsed) continue;
      const envId = edge.node.serviceInstances?.edges?.[0]?.node?.environmentId;
      if (!envId) continue;
      services.push({
        serviceId: edge.node.id,
        environmentId: envId,
        instanceId: parsed.instanceId,
        environment: parsed.environment,
      });
    }

    // Throttle between projects
    await new Promise((r) => setTimeout(r, 200));
  }

  return services;
}

// ── Metrics fetching ────────────────────────────────────────────────────────

async function fetchMemoryMetrics(
  token: string,
  serviceId: string,
  environmentId: string,
): Promise<{ currentMb: number; peakMb: number } | null> {
  try {
    const startDate = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const data = await railwayGql(
      token,
      `query($serviceId: String!, $environmentId: String!, $startDate: DateTime!, $measurements: [MetricMeasurement!]!) {
        metrics(serviceId: $serviceId, environmentId: $environmentId, startDate: $startDate, measurements: $measurements) {
          measurements {
            metric
            values { date value }
          }
        }
      }`,
      {
        serviceId,
        environmentId,
        startDate,
        measurements: ["MEMORY_USAGE_GB"],
      },
    );

    const values = data.metrics?.measurements?.[0]?.values || [];
    if (values.length === 0) return null;

    const mbValues = values.map((v: any) => (v.value || 0) * 1024);
    return {
      currentMb: Math.round(mbValues[mbValues.length - 1]),
      peakMb: Math.round(Math.max(...mbValues)),
    };
  } catch (err) {
    console.warn(`[cron] fetchMemoryMetrics(${serviceId}) failed:`, err);
    return null;
  }
}

// ── Sweep logic ─────────────────────────────────────────────────────────────

const MEMORY_LIMIT_MB = 8192;
const BATCH_SIZE = 5;

async function memorySweep(env: Env): Promise<void> {
  console.log("[cron] Memory sweep starting");

  const services = await listTeamServices(env.RAILWAY_API_TOKEN, env.RAILWAY_TEAM_ID);
  console.log(`[cron] Found ${services.length} assistant services`);

  const events: Array<{
    event: string;
    distinct_id: string;
    properties: Record<string, unknown>;
    timestamp: string;
  }> = [];

  for (let i = 0; i < services.length; i += BATCH_SIZE) {
    const batch = services.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (svc) => {
        const metrics = await fetchMemoryMetrics(
          env.RAILWAY_API_TOKEN,
          svc.serviceId,
          svc.environmentId,
        );
        return { svc, metrics };
      }),
    );

    for (const { svc, metrics } of results) {
      if (!metrics) continue;

      // Track all-time peak in KV
      const kvKey = `memory:${svc.instanceId}`;
      const lastPeakStr = await env.STATS_MEMORY.get(kvKey);
      const lastPeak = lastPeakStr ? parseFloat(lastPeakStr) : 0;
      const allTimePeak = Math.max(lastPeak, metrics.peakMb);
      await env.STATS_MEMORY.put(kvKey, String(allTimePeak));

      events.push({
        event: "instance_memory",
        distinct_id: `instance:${svc.instanceId}`,
        properties: {
          instance_id: svc.instanceId,
          environment: svc.environment,
          memory_current_mb: metrics.currentMb,
          memory_peak_mb: metrics.peakMb,
          memory_all_time_peak_mb: allTimePeak,
          memory_limit_mb: MEMORY_LIMIT_MB,
          memory_utilization_pct: Math.round((metrics.peakMb / MEMORY_LIMIT_MB) * 100),
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Throttle between batches
    if (i + BATCH_SIZE < services.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // Batch send to PostHog
  if (events.length > 0) {
    const host = env.POSTHOG_HOST || "https://us.i.posthog.com";
    try {
      const resp = await fetch(`${host}/batch/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: env.POSTHOG_API_KEY,
          batch: events,
          sent_at: new Date().toISOString(),
        }),
      });
      if (!resp.ok) {
        console.error(`[cron] PostHog batch failed: ${resp.status}`);
      } else {
        console.log(`[cron] Sent ${events.length} memory events to PostHog`);
      }
    } catch (err) {
      console.error("[cron] PostHog batch error:", err);
    }
  }

  console.log(`[cron] Memory sweep complete: ${events.length} events`);
}

// ── Worker entry ────────────────────────────────────────────────────────────

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(memorySweep(env));
  },
};
