/**
 * Smoke test — full create → status → configure → redeploy → destroy lifecycle.
 *
 * Mocks all external fetch calls (Railway GQL, OpenRouter, AgentMail, Telnyx)
 * but uses a real Postgres DB and real Express server.
 *
 * Requires: DATABASE_URL in env (or .env file).
 * Run:  node --env-file=.env --test dist/smoke.test.js
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { migrate } from "./db/migrate.js";
import { sql, pool as pgPool } from "./db/connection.js";

// ── Fake IDs ────────────────────────────────────────────────────────────────

const FAKE_SERVICE_ID = "svc-abc123";
const FAKE_VOLUME_ID = "vol-xyz789";
const FAKE_DOMAIN = "convos-agent-test123.up.railway.app";
const FAKE_DEPLOY_ID = "deploy-001";
const FAKE_OR_KEY = "sk-or-test-key";
const FAKE_OR_HASH = "hash-or-abc";
const FAKE_INBOX_ID = "inbox-test-999";
const FAKE_ENV_ID = "env-test-001";
const FAKE_PROJECT_ID = "proj-test-001";
const INSTANCE_ID = "test123abc";
const INSTANCE_NAME = `convos-agent-${INSTANCE_ID}`;

// ── Fetch mock ──────────────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;

/** Count calls per URL pattern for assertions. */
const fetchCalls: { url: string; method: string; body?: string }[] = [];

function mockFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const method = init?.method || "GET";
  const body = init?.body as string | undefined;
  fetchCalls.push({ url, method, body });

  // ── Railway GQL ───────────────────────────────────────────────────────
  if (url === "https://backboard.railway.com/graphql/v2") {
    const gqlBody = body ? JSON.parse(body) : {};
    const query: string = gqlBody.query || "";

    // serviceCreate
    if (query.includes("serviceCreate")) {
      return json({ data: { serviceCreate: { id: FAKE_SERVICE_ID } } });
    }
    // serviceInstanceUpdate
    if (query.includes("serviceInstanceUpdate")) {
      return json({ data: {} });
    }
    // environmentPatchCommit (resource limits)
    if (query.includes("environmentPatchCommit")) {
      return json({ data: {} });
    }
    // variableCollectionUpsert
    if (query.includes("variableCollectionUpsert")) {
      return json({ data: {} });
    }
    // volumeCreate
    if (query.includes("volumeCreate")) {
      return json({ data: { volumeCreate: { id: FAKE_VOLUME_ID, name: "data" } } });
    }
    // serviceDomainCreate
    if (query.includes("serviceDomainCreate")) {
      return json({ data: { serviceDomainCreate: { domain: FAKE_DOMAIN } } });
    }
    // listProjectServices (for status/batch)
    if (query.includes("project(id:") && query.includes("services(first:")) {
      // Also handles fetchAllVolumesByService if it includes volumes
      if (query.includes("volumes")) {
        return json({
          data: {
            project: {
              volumes: {
                edges: [{
                  node: {
                    id: FAKE_VOLUME_ID,
                    name: "data",
                    volumeInstances: {
                      edges: [{ node: { serviceId: FAKE_SERVICE_ID, mountPath: "/data" } }],
                    },
                  },
                }],
              },
              services: { edges: [] },
            },
          },
        });
      }
      return json({
        data: {
          project: {
            services: {
              edges: [{
                node: {
                  id: FAKE_SERVICE_ID,
                  name: INSTANCE_NAME,
                  createdAt: new Date().toISOString(),
                  serviceInstances: {
                    edges: [{
                      node: {
                        environmentId: FAKE_ENV_ID,
                        domains: {
                          serviceDomains: [{ domain: FAKE_DOMAIN }],
                          customDomains: [],
                        },
                        source: { image: "ghcr.io/xmtplabs/convos-runtime:latest" },
                      },
                    }],
                  },
                  deployments: {
                    edges: [{ node: { id: FAKE_DEPLOY_ID, status: "SUCCESS" } }],
                  },
                },
              }],
            },
          },
        },
      });
    }
    // fetchAllVolumesByService (standalone volumes query)
    if (query.includes("volumes") && !query.includes("services(first:")) {
      return json({
        data: {
          project: {
            volumes: {
              edges: [{
                node: {
                  id: FAKE_VOLUME_ID,
                  volumeInstances: {
                    edges: [{ node: { serviceId: FAKE_SERVICE_ID } }],
                  },
                },
              }],
            },
          },
        },
      });
    }
    // volumeDelete
    if (query.includes("volumeDelete")) {
      return json({ data: {} });
    }
    // deploymentRedeploy
    if (query.includes("deploymentRedeploy")) {
      return json({ data: {} });
    }
    // service query (for redeploy — fetch latest deployment)
    if (query.includes("service(id:") && query.includes("deployments")) {
      return json({
        data: {
          service: {
            deployments: { edges: [{ node: { id: FAKE_DEPLOY_ID } }] },
          },
        },
      });
    }
    // serviceDelete
    if (query.includes("serviceDelete")) {
      return json({ data: {} });
    }

    // Fallback — unknown GQL
    console.warn("[mock] Unknown GQL query:", query.slice(0, 80));
    return json({ data: {} });
  }

  // ── OpenRouter ────────────────────────────────────────────────────────
  if (url === "https://openrouter.ai/api/v1/keys" && method === "POST") {
    return json({ key: FAKE_OR_KEY, data: { hash: FAKE_OR_HASH } });
  }
  if (url.startsWith("https://openrouter.ai/api/v1/keys/") && method === "DELETE") {
    return json({}, 200);
  }

  // ── AgentMail ─────────────────────────────────────────────────────────
  if (url === "https://api.agentmail.to/v0/inboxes" && method === "POST") {
    return json({ inbox_id: FAKE_INBOX_ID });
  }
  if (url.startsWith("https://api.agentmail.to/v0/inboxes/") && method === "DELETE") {
    return json({}, 200);
  }

  // ── Telnyx ────────────────────────────────────────────────────────────
  // (not tested in this smoke — tools=["openrouter","agentmail"] only)

  console.warn(`[mock] Unhandled fetch: ${method} ${url}`);
  return json({ error: "mock not found" }, 404);
}

function json(data: unknown, status = 200): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  }));
}

// ── Test setup ──────────────────────────────────────────────────────────────

const API_KEY = "test-services-key";
let baseUrl: string;
let server: ReturnType<import("express").Express["listen"]>;

async function api(method: string, path: string, body?: unknown) {
  const res = await originalFetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  return { status: res.status, body: json };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("services smoke test", () => {
  before(async () => {
    // Set required env vars for the services app
    process.env.SERVICES_API_KEY = API_KEY;
    process.env.RAILWAY_API_TOKEN = "fake-token";
    process.env.RAILWAY_PROJECT_ID = FAKE_PROJECT_ID;
    process.env.RAILWAY_ENVIRONMENT_ID = FAKE_ENV_ID;
    process.env.RAILWAY_RUNTIME_IMAGE = "ghcr.io/xmtplabs/convos-runtime:latest";
    process.env.OPENROUTER_MANAGEMENT_KEY = "sk-or-mgmt-fake";
    process.env.AGENTMAIL_API_KEY = "fake-agentmail-key";
    process.env.AGENTMAIL_DOMAIN = "test.agentmail.to";
    // Leave TELNYX_API_KEY unset — telnyx won't be provisioned

    // Install fetch mock
    globalThis.fetch = mockFetch as typeof fetch;

    // Run migrations
    await migrate();

    // Clean up any leftover test data
    await sql`DELETE FROM instance_services WHERE instance_id = ${INSTANCE_ID}`;
    await sql`DELETE FROM instance_infra WHERE instance_id = ${INSTANCE_ID}`;

    // Start the Express server — import dynamically so env vars are already set
    const express = await import("express");
    const { requireAuth } = await import("./middleware/auth.js");
    const { infraRouter } = await import("./routes/infra.js");
    const { statusRouter } = await import("./routes/status.js");
    const { toolsRouter } = await import("./routes/tools.js");
    const { configureRouter } = await import("./routes/configure.js");
    const { registryRouter } = await import("./routes/registry.js");

    const app = express.default();
    app.use(express.default.json());
    app.get("/healthz", (_req, res) => res.json({ ok: true }));
    app.use(requireAuth);
    app.use(infraRouter);
    app.use(statusRouter);
    app.use(toolsRouter);
    app.use(configureRouter);
    app.use(registryRouter);

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        baseUrl = `http://127.0.0.1:${port}`;
        console.log(`[test] Server on ${baseUrl}`);
        resolve();
      });
    });
  });

  after(async () => {
    // Cleanup DB
    await sql`DELETE FROM instance_services WHERE instance_id = ${INSTANCE_ID}`;
    await sql`DELETE FROM instance_infra WHERE instance_id = ${INSTANCE_ID}`;
    server?.close();
    await pgPool.end();
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    fetchCalls.length = 0;
  });

  // ── 1. Healthz (no auth) ───────────────────────────────────────────────

  it("GET /healthz returns ok without auth", async () => {
    const res = await originalFetch(`${baseUrl}/healthz`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
  });

  // ── 2. Auth rejection ─────────────────────────────────────────────────

  it("rejects requests without auth", async () => {
    const res = await originalFetch(`${baseUrl}/registry`);
    const body = await res.json() as any;
    assert.equal(res.status, 401);
    assert.ok(body.error);
  });

  it("rejects requests with wrong auth", async () => {
    const res = await originalFetch(`${baseUrl}/registry`, {
      headers: { Authorization: "Bearer wrong-key" },
    });
    assert.equal(res.status, 401);
  });

  // ── 3. Registry ───────────────────────────────────────────────────────

  it("GET /registry returns tool list", async () => {
    const { status, body } = await api("GET", "/registry");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.tools));
    assert.ok(body.tools.length >= 3);
    const ids = body.tools.map((t: any) => t.id);
    assert.ok(ids.includes("openrouter"));
    assert.ok(ids.includes("agentmail"));
    assert.ok(ids.includes("telnyx"));
    // Each tool has envKeys
    for (const tool of body.tools) {
      assert.ok(Array.isArray(tool.envKeys));
      assert.ok(tool.envKeys.length > 0);
    }
  });

  // ── 4. Create instance ────────────────────────────────────────────────

  it("POST /create-instance provisions Railway + OpenRouter + AgentMail", async () => {
    const { status, body } = await api("POST", "/create-instance", {
      instanceId: INSTANCE_ID,
      name: INSTANCE_NAME,
      tools: ["openrouter", "agentmail"],
    });

    assert.equal(status, 200);
    assert.equal(body.instanceId, INSTANCE_ID);
    assert.equal(body.serviceId, FAKE_SERVICE_ID);
    assert.equal(body.url, `https://${FAKE_DOMAIN}`);
    // OpenRouter provisioned
    assert.ok(body.services.openrouter);
    assert.equal(body.services.openrouter.resourceId, FAKE_OR_HASH);

    // AgentMail provisioned
    assert.ok(body.services.agentmail);
    assert.equal(body.services.agentmail.resourceId, FAKE_INBOX_ID);

    // Telnyx NOT provisioned (no API key)
    assert.equal(body.services.telnyx, undefined);

    // Verify Railway GQL calls: serviceCreate, serviceInstanceUpdate,
    // environmentPatchCommit, variableCollectionUpsert, volumeCreate, serviceDomainCreate
    const gqlCalls = fetchCalls.filter((c) => c.url.includes("railway.com"));
    assert.ok(gqlCalls.length >= 5, `Expected >=5 Railway calls, got ${gqlCalls.length}`);

    // Verify OpenRouter was called
    const orCalls = fetchCalls.filter((c) => c.url.includes("openrouter.ai"));
    assert.equal(orCalls.length, 1);

    // Verify AgentMail was called
    const amCalls = fetchCalls.filter((c) => c.url.includes("agentmail.to"));
    assert.equal(amCalls.length, 1);

    // Verify DB rows
    const infra = await sql`SELECT * FROM instance_infra WHERE instance_id = ${INSTANCE_ID}`;
    assert.equal(infra.rows.length, 1);
    assert.equal(infra.rows[0].provider, "railway");
    assert.equal(infra.rows[0].provider_service_id, FAKE_SERVICE_ID);
    assert.equal(infra.rows[0].url, `https://${FAKE_DOMAIN}`);

    const svcs = await sql`SELECT * FROM instance_services WHERE instance_id = ${INSTANCE_ID} ORDER BY tool_id`;
    assert.equal(svcs.rows.length, 2);
    const toolIds = svcs.rows.map((r: any) => r.tool_id).sort();
    assert.deepEqual(toolIds, ["agentmail", "openrouter"]);
  });

  // ── 5. Status batch ───────────────────────────────────────────────────

  it("POST /status/batch returns agent services", async () => {
    const { status, body } = await api("POST", "/status/batch", {});
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.services));
    // Our mocked Railway returns one convos-agent- service
    const svc = body.services.find((s: any) => s.instanceId === INSTANCE_ID);
    assert.ok(svc, "Should find our instance in batch status");
    assert.equal(svc.serviceId, FAKE_SERVICE_ID);
    assert.equal(svc.deployStatus, "SUCCESS");
    assert.equal(svc.domain, FAKE_DOMAIN);
    assert.equal(svc.image, "ghcr.io/xmtplabs/convos-runtime:latest");
  });

  // ── 6. Configure ──────────────────────────────────────────────────────

  it("POST /configure/:instanceId sets env vars", async () => {
    const { status, body } = await api("POST", `/configure/${INSTANCE_ID}`, {
      variables: { MY_CUSTOM_VAR: "hello" },
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);

    // Should have called variableCollectionUpsert
    const gqlCalls = fetchCalls.filter((c) => c.url.includes("railway.com"));
    assert.ok(gqlCalls.length >= 1);
    const upsertCall = gqlCalls.find((c) => c.body?.includes("variableCollectionUpsert"));
    assert.ok(upsertCall, "Should call variableCollectionUpsert");
  });

  // ── 7. Redeploy ──────────────────────────────────────────────────────

  it("POST /redeploy/:instanceId triggers redeploy", async () => {
    const { status, body } = await api("POST", `/redeploy/${INSTANCE_ID}`);
    assert.equal(status, 200);
    assert.equal(body.ok, true);

    // Should have called: 1) query service deployments, 2) deploymentRedeploy
    const gqlCalls = fetchCalls.filter((c) => c.url.includes("railway.com"));
    assert.ok(gqlCalls.length >= 2);
  });

  // ── 8. Destroy ────────────────────────────────────────────────────────

  it("DELETE /destroy/:instanceId cleans up everything", async () => {
    const { status, body } = await api("DELETE", `/destroy/${INSTANCE_ID}`);
    assert.equal(status, 200);
    assert.equal(body.instanceId, INSTANCE_ID);
    assert.ok(body.destroyed);
    assert.equal(body.destroyed.openrouter, true);
    assert.equal(body.destroyed.agentmail, true);
    assert.equal(body.destroyed.volumes, true);
    assert.equal(body.destroyed.service, true);

    // OpenRouter key deleted
    const orDeletes = fetchCalls.filter(
      (c) => c.url.includes("openrouter.ai") && c.method === "DELETE",
    );
    assert.equal(orDeletes.length, 1);

    // AgentMail inbox deleted
    const amDeletes = fetchCalls.filter(
      (c) => c.url.includes("agentmail.to") && c.method === "DELETE",
    );
    assert.equal(amDeletes.length, 1);

    // DB rows cleaned up
    const infra = await sql`SELECT * FROM instance_infra WHERE instance_id = ${INSTANCE_ID}`;
    assert.equal(infra.rows.length, 0, "instance_infra row should be deleted");
    const svcs = await sql`SELECT * FROM instance_services WHERE instance_id = ${INSTANCE_ID}`;
    assert.equal(svcs.rows.length, 0, "instance_services rows should cascade-delete");
  });

  // ── 9. Destroy non-existent → 404 ────────────────────────────────────

  it("DELETE /destroy/:instanceId returns 404 for unknown instance", async () => {
    const { status, body } = await api("DELETE", "/destroy/does-not-exist");
    assert.equal(status, 404);
    assert.ok(body.error);
  });

  // ── 10. Create validates required fields ──────────────────────────────

  it("POST /create-instance returns 400 without instanceId", async () => {
    const { status, body } = await api("POST", "/create-instance", { name: "foo" });
    assert.equal(status, 400);
    assert.ok(body.error);
  });
});
