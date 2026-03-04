import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as pool from "./pool";
import * as db from "./db/pool";
import { config } from "./config";
import { requireAuth } from "./middleware/auth";
import { adminLogin, adminLogout, isAuthenticated, loginPage, adminPage } from "./admin";
import { eq, and } from "drizzle-orm";
import { db as pgDb } from "./db/connection";
import { instanceInfra, instanceServices } from "./db/schema";
import { updateServiceInstance, upsertVariables } from "./services/providers/railway";
import { resolveImageDigest } from "./services/providers/ghcr";
import * as openrouter from "./services/providers/openrouter";

import { initMetrics } from "./metrics";
import { webhookRouter } from "./webhookRoute";
import { skillsRouter } from "./routes/skills";
import { ensureWebhookRule } from "./webhook";

// Services routes (now local, no HTTP)
import { infraRouter } from "./services/routes/infra";
import { statusRouter } from "./services/routes/status";
import { configureRouter } from "./services/routes/configure";
import { toolsRouter } from "./services/routes/tools";
import { dashboardRouter } from "./services/routes/dashboard";
import { registryRouter } from "./services/routes/registry";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.disable("x-powered-by");
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// --- CORS for skills site ---
app.use((req, res, next) => {
  const origin = req.headers.origin || "";
  const allowed = config.skillsSiteOrigins.split(",").map((u) => u.trim());
  if (origin && allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
  if (req.method === "OPTIONS") { res.sendStatus(204); return; }
  next();
});

// --- Public routes ---
app.use("/admin/assets", express.static(join(__dirname, "..", "frontend")));
app.get("/favicon.ico", (_req, res) => res.sendFile(join(__dirname, "..", "frontend", "favicon.ico")));
app.get("/healthz", (_req, res) => res.json({ ok: true }));

const BUILD_VERSION = "2026-02-25T01:unified-pool-v1";
app.get("/version", (_req, res) => res.json({ version: BUILD_VERSION, environment: config.poolEnvironment }));

app.get("/api/pool/counts", async (_req, res) => {
  res.json(await db.getCounts());
});

app.get("/api/pool/agents", async (_req, res) => {
  const claimed = await db.getByStatus("claimed");
  const crashed = await db.getByStatus("crashed");
  const idle = await db.getByStatus("idle");
  const starting = await db.getByStatus("starting");
  res.json({ claimed, crashed, idle, starting });
});

app.get("/api/pool/info", (_req, res) => {
  res.json({
    environment: config.poolEnvironment,
    branch: config.deployBranch,
    model: config.instanceModel,
    railwayServiceId: config.railwayServiceId,
  });
});

// --- Skills (DB-backed CRUD + Auth0 JWT for mutations) ---
app.use(skillsRouter);

// --- Auth-protected pool API ---
app.delete("/api/pool/instances/:id", requireAuth, async (req, res) => {
  try {
    await pool.killInstance(req.params.id as string);
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[api] Kill failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// Self-destruct — instance requests its own destruction.
// Auth: instance sends its own ID + gateway token (per-instance secret).
// This prevents instances from destroying each other.
app.post("/api/pool/self-destruct", async (req, res) => {
  try {
    const { instanceId, gatewayToken } = req.body || {};
    if (!instanceId || !gatewayToken) {
      res.status(400).json({ error: "instanceId and gatewayToken are required" }); return;
    }
    const valid = await db.findInstanceByToken(instanceId, gatewayToken);
    if (!valid) {
      res.status(403).json({ error: "Invalid instance ID or token" }); return;
    }
    console.log(`[pool] Self-destruct requested by instance ${instanceId}`);
    res.json({ ok: true });
    // Destroy after responding — the instance doesn't need to wait
    pool.killInstance(instanceId).catch((err: any) => {
      console.error(`[pool] Self-destruct destroy failed for ${instanceId}:`, err.message);
    });
  } catch (err: any) {
    console.error("[api] Self-destruct failed:", err);
    res.status(500).json({ error: err.message });
  }
});


// --- Railway webhook (public — auth via secret in URL path) ---
app.use(webhookRouter);

// Credits check — instance queries its own spending balance.
// Auth: instance sends its own ID + gateway token (same as self-destruct).
app.post("/api/pool/credits-check", async (req, res) => {
  try {
    const { instanceId, gatewayToken } = req.body || {};
    if (!instanceId || !gatewayToken) {
      res.status(400).json({ error: "instanceId and gatewayToken are required" }); return;
    }
    const valid = await db.findInstanceByToken(instanceId, gatewayToken);
    if (!valid) {
      res.status(403).json({ error: "Invalid instance ID or token" }); return;
    }

    // Look up the instance's OpenRouter key from instance_services
    const svcRows = await pgDb.select({
      resourceId: instanceServices.resourceId,
      resourceMeta: instanceServices.resourceMeta,
    }).from(instanceServices).where(
      and(eq(instanceServices.instanceId, instanceId), eq(instanceServices.toolId, "openrouter"))
    );
    const svc = svcRows[0];
    if (!svc) {
      res.status(404).json({ error: "No credits service provisioned for this instance" }); return;
    }

    const hash = svc.resourceId;
    const limit = (svc.resourceMeta as any)?.limit ?? config.openrouterKeyLimit;

    // Fetch usage from OpenRouter API for this specific key
    const mgmtKey = config.openrouterManagementKey;
    if (!mgmtKey) {
      res.status(503).json({ error: "Credits service not configured on server" }); return;
    }
    const keyRes = await fetch(`https://openrouter.ai/api/v1/keys/${hash}`, {
      headers: { Authorization: `Bearer ${mgmtKey}` },
    });
    if (!keyRes.ok) {
      res.status(502).json({ error: `Failed to fetch key info from provider` }); return;
    }
    const keyData = (await keyRes.json() as any)?.data ?? {};
    const usage = keyData.usage ?? 0;
    const currentLimit = keyData.limit ?? limit;
    const remaining = Math.max(0, currentLimit - usage);

    res.json({ limit: currentLimit, usage, remaining, limitReset: keyData.limit_reset ?? config.openrouterKeyLimitReset });
  } catch (err: any) {
    console.error("[api] Credits check failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// Credits top-up — instance requests a spending limit increase.
// Auth: instance sends its own ID + gateway token (same as self-destruct).
app.post("/api/pool/credits-topup", async (req, res) => {
  try {
    const { instanceId, gatewayToken } = req.body || {};
    if (!instanceId || !gatewayToken) {
      res.status(400).json({ error: "instanceId and gatewayToken are required" }); return;
    }
    const valid = await db.findInstanceByToken(instanceId, gatewayToken);
    if (!valid) {
      res.status(403).json({ error: "Invalid instance ID or token" }); return;
    }

    // Look up the instance's OpenRouter key from instance_services
    const svcRows = await pgDb.select({
      id: instanceServices.id,
      resourceId: instanceServices.resourceId,
      resourceMeta: instanceServices.resourceMeta,
    }).from(instanceServices).where(
      and(eq(instanceServices.instanceId, instanceId), eq(instanceServices.toolId, "openrouter"))
    );
    const svc = svcRows[0];
    if (!svc) {
      res.status(404).json({ error: "No credits service provisioned for this instance" }); return;
    }

    const hash = svc.resourceId;
    const currentLimit = (svc.resourceMeta as any)?.limit ?? config.openrouterKeyLimit;
    const maxLimit = parseInt(process.env.OPENROUTER_TOPUP_MAX || "100", 10);

    if (currentLimit >= maxLimit) {
      res.status(409).json({ error: "Credit limit already at maximum", limit: currentLimit, max: maxLimit }); return;
    }

    const increment = parseInt(process.env.OPENROUTER_TOPUP_INCREMENT || "20", 10);
    const newLimit = Math.min(currentLimit + increment, maxLimit);

    await openrouter.updateKeyLimit(hash, newLimit);

    // Update resourceMeta.limit in DB
    const updatedMeta = { ...(svc.resourceMeta as any || {}), limit: newLimit };
    await pgDb.update(instanceServices).set({ resourceMeta: updatedMeta }).where(eq(instanceServices.id, svc.id));

    console.log(`[pool] Credits top-up for instance ${instanceId}: $${currentLimit} → $${newLimit}`);
    res.json({ ok: true, previousLimit: currentLimit, newLimit });
  } catch (err: any) {
    console.error("[api] Credits top-up failed:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/pool/recheck/:id", requireAuth, async (req, res) => {
  try {
    const result = await pool.recheckInstance(req.params.id as string);
    res.json({ ok: true, ...result });
  } catch (err: any) {
    console.error("[api] Recheck failed:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/pool/update-runtime/:id", requireAuth, async (req, res) => {
  try {
    const id = req.params.id as string;
    const infraRows = await pgDb.select().from(instanceInfra).where(eq(instanceInfra.instanceId, id));
    const infra = infraRows[0];
    if (!infra) {
      res.status(404).json({ error: `Instance ${id} not found` }); return;
    }
    const rawImage = config.railwayRuntimeImage;
    if (!rawImage) {
      res.status(400).json({ error: "No runtime image configured" }); return;
    }
    const image = await resolveImageDigest(rawImage);
    const opts = { projectId: infra.providerProjectId || undefined, environmentId: infra.providerEnvId };
    await updateServiceInstance(infra.providerServiceId, { source: { image } }, opts);
    // Upsert a variable to trigger a NEW deployment with the updated image.
    // redeployService replays the old deployment (old image), so we need this instead.
    await upsertVariables(infra.providerServiceId, { RUNTIME_UPDATED_AT: new Date().toISOString() }, { skipDeploys: false }, opts);
    await pgDb.update(instanceInfra).set({ runtimeImage: image }).where(eq(instanceInfra.instanceId, id));
    console.log(`[api] Updated runtime for ${id} → ${image}`);
    res.json({ ok: true, instanceId: id, image });
  } catch (err: any) {
    console.error("[api] Update runtime failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// Root redirect
app.get("/", (_req, res) => {
  res.redirect(302, config.skillsSiteUrl);
});

// --- Admin dashboard (password-protected) ---
const POOL_ADMIN_URLS = config.poolAdminUrls.split(",").filter(Boolean).map((entry) => {
  const [env, url] = entry.split("=", 2);
  return { env: env?.trim() || "", url: url?.trim() || "" };
}).filter((e): e is { env: string; url: string } => !!e.env && !!e.url);

app.get("/admin", (req, res) => {
  if (!isAuthenticated(req)) { res.type("html").send(loginPage(null)); return; }
  res.type("html").send(adminPage({
    poolEnvironment: config.poolEnvironment,
    deployBranch: config.deployBranch,
    railwayServiceId: config.railwayServiceId,
    runtimeImage: config.railwayRuntimeImage,
    bankrConfigured: !!config.bankrApiKey,
    adminUrls: POOL_ADMIN_URLS as any,
  }));
});

app.post("/admin/login", (req, res) => {
  const { password } = req.body || {};
  if (adminLogin(password, res)) { res.redirect(302, "/admin"); return; }
  res.type("html").send(loginPage("Invalid API key"));
});

app.post("/admin/logout", (req, res) => {
  adminLogout(req, res);
  res.redirect(302, "/admin");
});

// --- Pool management API ---
app.get("/api/pool/status", requireAuth, async (_req, res) => {
  const counts = await db.getCounts();
  const instances = await db.listAll();
  res.json({ counts, instances });
});

app.post("/api/pool/claim", requireAuth, async (req, res) => {
  const { agentName, instructions, joinUrl } = req.body || {};
  if (instructions && typeof instructions !== "string") {
    res.status(400).json({ error: "instructions must be a string if provided" }); return;
  }
  if (agentName && typeof agentName !== "string") {
    res.status(400).json({ error: "agentName must be a string if provided" }); return;
  }
  if (joinUrl && typeof joinUrl !== "string") {
    res.status(400).json({ error: "joinUrl must be a string if provided" }); return;
  }
  if (joinUrl && config.poolEnvironment === "production" && /dev\.convos\.org/i.test(joinUrl)) {
    res.status(400).json({ error: "dev.convos.org links cannot be used in the production environment" }); return;
  }
  if (joinUrl && config.poolEnvironment !== "production" && /popup\.convos\.org/i.test(joinUrl)) {
    res.status(400).json({ error: `popup.convos.org links cannot be used in the ${config.poolEnvironment} environment` }); return;
  }

  try {
    const result = await pool.provision({
      agentName: agentName || "Assistant",
      instructions: instructions || "You are a helpful AI assistant.",
      joinUrl: joinUrl || undefined,
    });
    if (!result) {
      res.status(503).json({ error: "No idle instances available. Try again in a few minutes." }); return;
    }
    res.json(result);
  } catch (err: any) {
    console.error("[api] Launch failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- SSE streaming endpoint for claim/launch with real-time progress ---
app.get("/api/pool/claim/stream", requireAuth, async (req, res) => {
  const agentName = (req.query.agentName as string) || "Assistant";
  const instructions = (req.query.instructions as string) || "You are a helpful AI assistant.";
  const joinUrl = (req.query.joinUrl as string) || undefined;

  if (joinUrl && config.poolEnvironment === "production" && /dev\.convos\.org/i.test(joinUrl)) {
    res.status(400).json({ error: "dev.convos.org links cannot be used in the production environment" }); return;
  }
  if (joinUrl && config.poolEnvironment !== "production" && /popup\.convos\.org/i.test(joinUrl)) {
    res.status(400).json({ error: `popup.convos.org links cannot be used in the ${config.poolEnvironment} environment` }); return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (data: Record<string, any>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const result = await pool.provision({
      agentName,
      instructions,
      joinUrl,
      onProgress(step, status, message) {
        send({ type: "step", step, status, message: message || "" });
      },
    });

    if (!result) {
      send({ type: "complete", ok: false, error: "No idle instances available. Try again in a few minutes." });
    } else {
      send({ type: "complete", ok: true, ...result });
    }
  } catch (err: any) {
    send({ type: "complete", ok: false, error: err.message });
  }

  res.end();
});

// --- SSE streaming endpoint for provisioning with real-time progress ---
app.get("/api/pool/replenish/stream", requireAuth, async (req, res) => {
  const count = Math.min(parseInt(req.query.count as string) || 1, 20);
  const image = (req.query.image as string) || "";

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (data: Record<string, any>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  let created = 0;
  let failed = 0;
  const MAX_CONCURRENCY = Math.min(Math.max(parseInt(req.query.concurrency as string) || 5, 1), 5);

  // Concurrency-limited parallel provisioning
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < count) {
      const i = nextIndex++;
      const instanceNum = i + 1;
      try {
        const inst = await pool.createInstance((step, status, message) => {
          if (step === "done") return;
          send({ type: "step", instanceNum, step, status, message: message || "" });
        }, image || undefined);
        send({ type: "instance", instanceNum, instance: inst });
        send({ type: "step", instanceNum, instanceId: inst.id, step: "done", status: "ok", message: "" });
        created++;
      } catch (err: any) {
        send({ type: "step", instanceNum, step: "error", status: "fail", message: err.message });
        failed++;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, count) }, () => worker()));

  const counts = await db.getCounts();
  send({ type: "complete", created, failed, counts });
  res.end();
});

app.post("/api/pool/replenish", requireAuth, async (req, res) => {
  try {
    const count = Math.min(parseInt(req.body?.count) || 0, 20);
    if (count > 0) {
      const results: any[] = [];
      const MAX_CONCURRENCY = Math.min(Math.max(parseInt(req.body?.concurrency) || 5, 1), 5);
      let nextIndex = 0;
      async function worker() {
        while (nextIndex < count) {
          nextIndex++;
          try {
            const inst = await pool.createInstance();
            results.push(inst);
          } catch (err: any) {
            console.error(`[pool] Failed to create instance:`, err);
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, count) }, () => worker()));
      res.json({ ok: true, created: results.length, instances: results, counts: await db.getCounts() }); return;
    }
    const result = await pool.checkStarting();
    res.json({ ok: true, counts: await db.getCounts(), checkStarting: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/pool/check-starting", requireAuth, async (_req, res) => {
  try {
    const result = await pool.checkStarting();
    res.json({ ok: true, counts: await db.getCounts(), ...result });
  } catch (err: any) {
    console.error("[api] check-starting failed:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/pool/drain/stream", requireAuth, async (req, res) => {
  const count = Math.min(parseInt(req.query.count as string) || 20, 20);
  const concurrency = Math.min(Math.max(parseInt(req.query.concurrency as string) || 5, 1), 10);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (data: Record<string, any>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const result = await pool.drainPoolStream(count, concurrency, (instanceNum, instanceId, instanceName, step, status, message) => {
    send({ type: "step", instanceNum, instanceId, instanceName, step, status, message: message || "" });
  });

  const counts = await db.getCounts();
  send({ type: "complete", drained: result.drained, failed: result.failed, drainedIds: result.instances, counts });
  res.end();
});

app.post("/api/pool/drain", requireAuth, async (req, res) => {
  try {
    const count = Math.min(parseInt(req.body?.count) || 1, 20);
    const drained = await pool.drainPool(count);
    res.json({ ok: true, drained: drained.length, drainedIds: drained, counts: await db.getCounts() });
  } catch (err: any) {
    console.error("[api] Drain failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- Services routes (previously separate service, now local) ---
app.use(registryRouter); // registry is public
app.use(requireAuth, dashboardRouter);
app.use(requireAuth, infraRouter);
app.use(requireAuth, statusRouter);
app.use(requireAuth, configureRouter);
app.use(requireAuth, toolsRouter);

// --- Startup: migrate, seed, then tick loop ---
import { runMigrations } from "./db/migrate";
import { seedCatalog } from "./db/seed";

// --- Metrics ---
initMetrics();

runMigrations()
  .then(() => seedCatalog())
  .then(() => {
    ensureWebhookRule().catch((err) =>
      console.warn("[startup] Webhook rule registration failed:", err.message));
  })
  .catch((err) => {
    console.error("[startup] Migration failed:", err);
    process.exit(1);
  });

app.listen(config.port, () => {
  console.log(`Pool manager listening on :${config.port}`);
});
