import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import * as pool from "./pool";
import * as db from "./db/pool";
import { config } from "./config";
import { requireAuth } from "./middleware/auth";
import { adminLogin, adminLogout, isAuthenticated, loginPage, dashboardPage, upgradesPage, apiDocsPage } from "./admin";
import { eq, and, inArray } from "drizzle-orm";
import { db as pgDb } from "./db/connection";
import { instanceInfra, instanceServices } from "./db/schema";
import { deployImage, redeployService, fetchServiceStatus } from "./services/providers/railway";
import { resolveImageDigest } from "./services/providers/ghcr";
import * as openrouter from "./services/providers/openrouter";

import { initMetrics } from "./metrics";
import { webhookRouter } from "./webhookRoute";
import { ensureWebhookRule } from "./webhook";
import { couponRouter } from "./couponRoute";
import { stripeRouter } from "./stripeRoute";
import * as stripe from "./services/providers/stripe";
import { serviceProxyRouter } from "./routes/serviceProxy";
import { skillsRouter } from "./routes/skills";
import { seedCatalog } from "./db/seed";

// Services routes (now local, no HTTP)
import { infraRouter } from "./services/routes/infra";
import { statusRouter } from "./services/routes/status";
import { configureRouter } from "./services/routes/configure";
import { toolsRouter } from "./services/routes/tools";
import { dashboardRouter } from "./services/routes/dashboard";
import { registryRouter } from "./services/routes/registry";
import { signAttestation, buildJwksFromConfig } from "./attestation";
import { authFetch } from "./authFetch";

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Agent catalog for prompt store ---
const AGENT_CATALOG_JSON = (() => {
  try {
    const catalogPath = resolve(__dirname, "agents-data.json");
    const raw = JSON.parse(readFileSync(catalogPath, "utf8"));
    const compact = raw.map((a: any) => {
      const url = a.subPageUrl || "";
      const m = url.match(/([a-f0-9]{32})/);
      const catParts = (a.category || "").split(" — ");
      const emoji = catParts[0].trim().split(" ")[0];
      let catName = catParts[0].trim().replace(/^\S+\s/, "").replace(/\s*&\s*.+$/, "");
      if (catName === "Superpower Agents") catName = "Superpowers";
      if (catName === "Neighborhood") catName = "Local";
      if (catName === "Professional") catName = "Work";
      return { n: a.name, d: a.description, c: catName, e: emoji, p: m ? m[1] : "", s: a.status };
    }).filter((a: any) => a.n && a.p);
    return JSON.stringify(compact);
  } catch (e: any) {
    console.warn("[pool] Could not load agents catalog:", e.message);
    return "[]";
  }
})();

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const AGENT_CATALOG = (() => {
  try {
    const catalogPath = resolve(__dirname, "agents-data.json");
    const raw = JSON.parse(readFileSync(catalogPath, "utf8"));
    return raw.filter((a: any) => a.name).map((a: any) => {
      const url = a.subPageUrl || "";
      const m = url.match(/([a-f0-9]{32})/);
      const catParts = (a.category || "").split(" — ");
      const emoji = catParts[0].trim().split(" ")[0];
      let catName = catParts[0].trim().replace(/^\S+\s/, "").replace(/\s*&\s*.+$/, "");
      if (catName === "Superpower Agents") catName = "Superpowers";
      if (catName === "Neighborhood") catName = "Local";
      if (catName === "Professional") catName = "Work";
      return {
        slug: slugify(a.name), name: a.name, description: a.description,
        category: catName, emoji, skills: a.skills || [], status: a.status,
        notionPageId: m ? m[1] : null,
      };
    }).filter((a: any) => a.notionPageId);
  } catch (e: any) {
    console.warn("[pool] Could not load agents catalog:", e.message);
    return [];
  }
})();

const app = express();
app.disable("x-powered-by");
// Higher limit for proxy routes (email attachments are base64-encoded in body)
app.use("/api/proxy", express.json({ limit: "10mb" }));
// Skip JSON parsing for Stripe webhooks — they need the raw body for signature verification
app.use((req, res, next) => {
  if (req.path === "/webhooks/stripe") return next();
  express.json()(req, res, next);
});
app.use(express.urlencoded({ extended: false }));

// --- CORS for template site ---
app.use((req, res, next) => {
  const origin = req.headers.origin || "";
  const allowed = config.templateSiteOrigins.split(",").map((u) => u.trim());
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

// JWKS — public endpoint for agent attestation verification.
// Production: hosted on convos.org. This serves as dev/staging fallback.
app.get("/.well-known/agents.json", (_req, res) => {
  try {
    res.json(buildJwksFromConfig());
  } catch (err: any) {
    res.status(503).json({ error: "Attestation not configured" });
  }
});

app.get("/api/pool/counts", async (_req, res) => {
  res.json(await db.getCounts());
});

app.get("/api/pool/agents", async (_req, res) => {
  const claimed = await db.getByStatus("claimed");
  const pendingAcceptance = await db.getByStatus("pending_acceptance");
  const tainted = await db.getByStatus("tainted");
  const crashed = await db.getByStatus("crashed");
  const idle = await db.getByStatus("idle");
  const starting = await db.getByStatus("starting");
  res.json({ claimed, pendingAcceptance, tainted, crashed, idle, starting });
});

app.get("/api/pool/info", (_req, res) => {
  res.json({
    environment: config.poolEnvironment,
    branch: config.deployBranch,
    model: config.instanceModel,
    railwayServiceId: config.railwayServiceId,
  });
});

app.use(skillsRouter);

app.get("/api/pool/templates", (_req, res) => { res.json(AGENT_CATALOG); });
app.get("/api/pool/templates/:slug", (req, res) => {
  const t = AGENT_CATALOG.find((a: any) => a.slug === req.params.slug);
  if (!t) { res.status(404).json({ error: "Template not found" }); return; }
  res.json(t);
});

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

// Self-info — instance queries its own runtime version and image.
// Auth: instance sends its own ID + gateway token (same as self-destruct).
app.post("/api/pool/self-info", async (req, res) => {
  try {
    const { instanceId, gatewayToken } = req.body || {};
    if (!instanceId || !gatewayToken) {
      res.status(400).json({ error: "instanceId and gatewayToken are required" }); return;
    }
    const valid = await db.findInstanceByToken(instanceId, gatewayToken);
    if (!valid) {
      res.status(403).json({ error: "Invalid instance ID or token" }); return;
    }
    const infraRows = await pgDb.select({
      runtimeVersion: instanceInfra.runtimeVersion,
      runtimeImage: instanceInfra.runtimeImage,
    }).from(instanceInfra).where(eq(instanceInfra.instanceId, instanceId));
    const infra = infraRows[0];
    if (!infra) {
      res.status(404).json({ error: `Instance ${instanceId} infra not found` }); return;
    }
    res.json({
      ok: true,
      instanceId,
      runtimeVersion: infra.runtimeVersion ?? null,
      runtimeImage: infra.runtimeImage ?? null,
      latestImage: config.railwayRuntimeImage ?? null,
    });
  } catch (err: any) {
    console.error("[api] Self-info failed:", err);
    res.status(500).json({ error: err.message });
  }
});

/** Detect harness type from a container image reference. */
function detectHarnessFromImage(image: string): "openclaw" | "hermes" | null {
  if (image.includes("runtime-hermes")) return "hermes";
  if (image.includes("convos-runtime")) return "openclaw";
  return null;
}

/**
 * Upgrade an instance's runtime image on Railway.
 *
 * Resolves the tag to a sha256 digest and deploys via environmentPatchCommit
 * (the same atomic mechanism used by createService). This ensures Railway
 * treats it as a real config change and pulls the new image.
 */
async function upgradeInstanceRuntime(
  instanceId: string,
  infra: { providerServiceId: string; providerProjectId: string | null; providerEnvId: string; runtimeType?: string | null },
  imageOverride?: string,
): Promise<string> {
  const rawImage = imageOverride || config.railwayRuntimeImage;
  if (!rawImage) throw new Error("No runtime image configured");

  // Guard: don't deploy an openclaw image to a hermes instance or vice versa.
  const targetHarness = detectHarnessFromImage(rawImage);
  const currentHarness = infra.runtimeType as "openclaw" | "hermes" | null;
  if (targetHarness && currentHarness && targetHarness !== currentHarness) {
    throw new Error(`Harness mismatch: instance is ${currentHarness} but image is ${targetHarness} (${rawImage})`);
  }

  const image = await resolveImageDigest(rawImage);
  const opts = { projectId: infra.providerProjectId || undefined, environmentId: infra.providerEnvId };

  const status = await fetchServiceStatus(infra.providerServiceId, infra.providerEnvId);
  console.log(`[upgrade] ${instanceId}: service=${infra.providerServiceId} env=${infra.providerEnvId} raw=${rawImage} resolved=${image} current=${status?.image ?? "unknown"} status=${status?.deployStatus ?? "unknown"}`);
  await deployImage(infra.providerServiceId, image, opts);
  console.log(`[upgrade] ${instanceId}: deploy committed`);
  await pgDb.update(instanceInfra).set({ runtimeImage: rawImage }).where(eq(instanceInfra.instanceId, instanceId));
  return rawImage;
}

// Self-upgrade — instance requests a runtime image update for itself.
// Auth: instance sends its own ID + gateway token (same as self-destruct).
app.post("/api/pool/self-upgrade", async (req, res) => {
  try {
    const { instanceId, gatewayToken } = req.body || {};
    if (!instanceId || !gatewayToken) {
      res.status(400).json({ error: "instanceId and gatewayToken are required" }); return;
    }
    const valid = await db.findInstanceByToken(instanceId, gatewayToken);
    if (!valid) {
      res.status(403).json({ error: "Invalid instance ID or token" }); return;
    }
    const infraRows = await pgDb.select().from(instanceInfra).where(eq(instanceInfra.instanceId, instanceId));
    const infra = infraRows[0];
    if (!infra) {
      res.status(404).json({ error: `Instance ${instanceId} infra not found` }); return;
    }
    const image = await upgradeInstanceRuntime(instanceId, infra);
    console.log(`[pool] Self-upgrade requested by instance ${instanceId} → ${image}`);
    res.json({ ok: true, instanceId, image });
  } catch (err: any) {
    console.error("[api] Self-upgrade failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// Self-reset — instance requests a redeploy (same image, fresh container).
// Auth: instance sends its own ID + gateway token (same as self-destruct).
app.post("/api/pool/self-reset", async (req, res) => {
  try {
    const { instanceId, gatewayToken } = req.body || {};
    if (!instanceId || !gatewayToken) {
      res.status(400).json({ error: "instanceId and gatewayToken are required" }); return;
    }
    const valid = await db.findInstanceByToken(instanceId, gatewayToken);
    if (!valid) {
      res.status(403).json({ error: "Invalid instance ID or token" }); return;
    }
    const infraRows = await pgDb.select().from(instanceInfra).where(eq(instanceInfra.instanceId, instanceId));
    const infra = infraRows[0];
    if (!infra) {
      res.status(404).json({ error: `Instance ${instanceId} infra not found` }); return;
    }
    const opts = { projectId: infra.providerProjectId || undefined, environmentId: infra.providerEnvId };
    await redeployService(infra.providerServiceId, opts);
    console.log(`[pool] Self-reset requested by instance ${instanceId}`);
    res.json({ ok: true, instanceId });
  } catch (err: any) {
    console.error("[api] Self-reset failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// Pending acceptance callbacks — runtime notifies pool when a pending join resolves.
app.post("/api/pool/pending-acceptance/complete", async (req, res) => {
  try {
    const { instanceId, gatewayToken, conversationId } = req.body || {};
    if (!instanceId || !gatewayToken || !conversationId) {
      res.status(400).json({ error: "instanceId, gatewayToken, and conversationId are required" }); return;
    }
    const valid = await db.findInstanceByToken(instanceId, gatewayToken);
    if (!valid) {
      res.status(403).json({ error: "Invalid instance ID or token" }); return;
    }
    const updated = await db.completePendingAcceptance(instanceId, conversationId);
    res.json({ ok: updated, instanceId, conversationId });
  } catch (err: any) {
    console.error("[api] pending-acceptance complete failed:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/pool/pending-acceptance/fail", async (req, res) => {
  try {
    const { instanceId, gatewayToken } = req.body || {};
    if (!instanceId || !gatewayToken) {
      res.status(400).json({ error: "instanceId and gatewayToken are required" }); return;
    }
    const valid = await db.findInstanceByToken(instanceId, gatewayToken);
    if (!valid) {
      res.status(403).json({ error: "Invalid instance ID or token" }); return;
    }
    const updated = await db.failPendingAcceptance(instanceId);
    res.json({ ok: updated, instanceId });
  } catch (err: any) {
    console.error("[api] pending-acceptance fail failed:", err);
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

// Attest — instance requests a signed attestation for its inbox ID.
// Auth: instance sends its own ID + gateway token (same as self-destruct).
app.post("/api/pool/attest", async (req, res) => {
  try {
    const { instanceId, gatewayToken, inboxId } = req.body || {};
    if (!instanceId || !gatewayToken || !inboxId) {
      res.status(400).json({ error: "instanceId, gatewayToken, and inboxId are required" });
      return;
    }
    const valid = await db.findInstanceByToken(instanceId, gatewayToken);
    if (!valid) {
      res.status(403).json({ error: "Invalid credentials" });
      return;
    }
    const result = signAttestation(inboxId);
    res.json(result);
  } catch (err: any) {
    console.error("[api] attest failed:", err);
    res.status(500).json({ error: err.message });
  }
});


// --- Railway webhook (public — auth via secret in URL path) ---
app.use(webhookRouter);
app.use(couponRouter);
app.use(stripeRouter);

// --- Service proxy (instance auth via gateway token) ---
app.use(serviceProxyRouter);

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

    // Lazily ensure a Stripe customer exists (fire-and-forget)
    stripe.ensureCustomer({ instanceId })
      .catch((err) => console.warn(`[stripe] Failed to ensure customer for ${instanceId}:`, err.message));

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

// Re-attest — admin triggers a fresh attestation for a running instance.
app.post("/api/pool/re-attest/:id", requireAuth, async (req, res) => {
  try {
    const inst = await db.findById(req.params.id as string);
    if (!inst) { res.status(404).json({ error: "Instance not found" }); return; }
    if (!inst.url) { res.status(400).json({ error: "Instance has no URL" }); return; }

    const token = await db.getGatewayToken(inst.id);
    if (!token) { res.status(400).json({ error: "No gateway token for instance" }); return; }

    // Get inboxId from runtime
    const statusRes = await authFetch(`${inst.url}/convos/status`, {
      gatewayToken: token,
      signal: AbortSignal.timeout(10_000),
    });
    if (!statusRes.ok) {
      res.status(502).json({ error: `Runtime status check failed: ${statusRes.status}` });
      return;
    }
    const status = await statusRes.json() as { inboxId?: string; conversationId?: string };
    if (!status.inboxId) {
      res.status(400).json({ error: "Runtime has no inboxId (agent not provisioned?)" });
      return;
    }

    // Sign attestation
    const attestation = signAttestation(status.inboxId);

    // Push to runtime
    const reattestRes = await authFetch(`${inst.url}/convos/re-attest`, {
      gatewayToken: token,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify(attestation),
    });
    if (!reattestRes.ok) {
      const text = await reattestRes.text();
      res.status(502).json({ error: `Runtime re-attest failed: ${reattestRes.status} ${text.slice(0, 500)}` });
      return;
    }

    res.json({ ok: true, instanceId: inst.id, inboxId: status.inboxId, ...attestation });
  } catch (err: any) {
    console.error("[api] re-attest failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// Re-attest all active instances (bulk backfill for upgrades / key rotation).
app.post("/api/pool/re-attest-all", requireAuth, async (req, res) => {
  try {
    const claimed = await db.getByStatus(["claimed", "pending_acceptance", "crashed"]);
    const results: Array<{ id: string; ok: boolean; error?: string }> = [];

    for (const inst of claimed) {
      if (!inst.url) {
        results.push({ id: inst.id, ok: false, error: "no URL" });
        continue;
      }
      try {
        const token = await db.getGatewayToken(inst.id);
        if (!token) {
          results.push({ id: inst.id, ok: false, error: "no gateway token" });
          continue;
        }

        const statusRes = await authFetch(`${inst.url}/convos/status`, {
          gatewayToken: token,
          signal: AbortSignal.timeout(10_000),
        });
        if (!statusRes.ok) {
          results.push({ id: inst.id, ok: false, error: `status ${statusRes.status}` });
          continue;
        }
        const status = await statusRes.json() as { inboxId?: string };
        if (!status.inboxId) {
          results.push({ id: inst.id, ok: false, error: "no inboxId" });
          continue;
        }

        const attestation = signAttestation(status.inboxId);
        const reattestRes = await authFetch(`${inst.url}/convos/re-attest`, {
          gatewayToken: token,
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(10_000),
          body: JSON.stringify(attestation),
        });
        if (!reattestRes.ok) {
          results.push({ id: inst.id, ok: false, error: `re-attest ${reattestRes.status}` });
          continue;
        }
        results.push({ id: inst.id, ok: true });
      } catch (err: any) {
        results.push({ id: inst.id, ok: false, error: err.message?.slice(0, 200) });
      }
    }

    const succeeded = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;
    res.json({ ok: true, total: results.length, succeeded, failed, results });
  } catch (err: any) {
    console.error("[api] re-attest-all failed:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/pool/update-runtime/:id", requireAuth, async (req, res) => {
  try {
    const id = req.params.id as string;
    const { image: imageOverride } = req.body || {};
    const infraRows = await pgDb.select().from(instanceInfra).where(eq(instanceInfra.instanceId, id));
    const infra = infraRows[0];
    if (!infra) {
      res.status(404).json({ error: `Instance ${id} not found` }); return;
    }
    const image = await upgradeInstanceRuntime(id, infra, imageOverride);
    console.log(`[api] Updated runtime for ${id} → ${image}`);
    res.json({ ok: true, instanceId: id, image });
  } catch (err: any) {
    console.error("[api] Update runtime failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- SSE streaming endpoint for mass runtime upgrade ---
app.get("/api/pool/upgrade/stream", requireAuth, async (req, res) => {
  const idList = ((req.query.ids as string) || "").split(",").filter(Boolean);
  const imageOverride = (req.query.image as string) || "";

  if (!idList.length) { res.status(400).json({ error: "No instance IDs" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (data: Record<string, any>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Look up all instances + infra
  const allRows = await db.getByStatus(["idle", "claimed", "starting", "crashed"]);
  const infraRows = await pgDb.select({
    instanceId: instanceInfra.instanceId,
    providerServiceId: instanceInfra.providerServiceId,
    providerProjectId: instanceInfra.providerProjectId,
    providerEnvId: instanceInfra.providerEnvId,
    runtimeVersion: instanceInfra.runtimeVersion,
    runtimeImage: instanceInfra.runtimeImage,
    runtimeType: instanceInfra.runtimeType,
  }).from(instanceInfra).where(inArray(instanceInfra.instanceId, idList));
  const infraById: Record<string, typeof infraRows[0]> = {};
  infraRows.forEach(r => { infraById[r.instanceId] = r; });

  // Send instance info upfront so the frontend can render cards
  idList.forEach((id, i) => {
    const agent = allRows.find(a => a.id === id);
    const infra = infraById[id];
    const name = agent ? ((agent as any).agentName || (agent as any).name || id) : id;
    const version = infra?.runtimeVersion || "unknown";
    let railwayUrl: string | null = null;
    if (infra?.providerProjectId && infra?.providerServiceId) {
      railwayUrl = `https://railway.com/project/${infra.providerProjectId}/service/${infra.providerServiceId}`;
      if (infra.providerEnvId) railwayUrl += `?environmentId=${infra.providerEnvId}`;
    }
    const runtimeType = infra?.runtimeType || null;
    const harness = runtimeType || (infra ? detectHarnessFromImage(infra.runtimeImage || "") : null) || "unknown";
    send({ type: "info", instanceNum: i + 1, instanceId: id, name, version, harness, runtimeType, railwayUrl });
  });

  // Resolve target image label for "from → to" display
  const targetImage = imageOverride || config.railwayRuntimeImage || "";
  const targetHarness = detectHarnessFromImage(targetImage);
  // Extract tag from image (e.g. "ghcr.io/xmtplabs/convos-runtime:dev" → "dev")
  const targetTag = targetImage.includes(":") ? targetImage.split(":").pop() || "" : "";

  let upgraded = 0, failed = 0;

  for (let i = 0; i < idList.length; i++) {
    const id = idList[i];
    const instanceNum = i + 1;
    const infra = infraById[id];

    if (!infra) {
      send({ type: "step", instanceNum, step: "error", status: "fail", message: "Instance infra not found" });
      failed++;
      continue;
    }

    try {
      send({ type: "step", instanceNum, step: "deploy", status: "active", message: "Deploying..." });
      const image = await upgradeInstanceRuntime(id, infra, imageOverride || undefined);
      send({ type: "step", instanceNum, step: "done", status: "ok", message: image, targetImage: image, targetTag });
      upgraded++;
    } catch (err: any) {
      send({ type: "step", instanceNum, step: "error", status: "fail", message: err.message });
      failed++;
    }
  }

  send({ type: "complete", upgraded, failed, total: idList.length });
  res.end();
});

// --- SSE streaming endpoint for refresh-versions ---
app.get("/api/pool/refresh-versions/stream", requireAuth, async (req, res) => {
  const idList = ((req.query.ids as string) || "").split(",").filter(Boolean);
  if (!idList.length) { res.status(400).json({ error: "No instance IDs" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (data: Record<string, any>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const rows = await db.getByStatus(["idle", "claimed"]);
  const targets = rows.filter((r) => idList.includes(r.id));
  let updated = 0;

  for (let i = 0; i < targets.length; i++) {
    const row = targets[i];
    if (!row.url) {
      send({ type: "result", instanceId: row.id, name: (row as any).agentName || (row as any).name || row.id, status: "skip", reason: "no url" });
      continue;
    }
    try {
      const token = await db.getGatewayToken(row.id);
      const hcResult = await pool.healthCheck(row.url, token);
      if (hcResult.ok) {
        const hc = hcResult.data;
        if (hc.version) {
          await db.setRuntimeVersion(row.id, hc.version, hc.runtime);
          updated++;
        }
        send({ type: "result", instanceId: row.id, name: (row as any).agentName || (row as any).name || row.id, status: "ok", version: hc.version || "unknown", runtime: hc.runtime || "unknown" });
      } else {
        send({ type: "result", instanceId: row.id, name: (row as any).agentName || (row as any).name || row.id, status: "fail", reason: hcResult.reason });
      }
    } catch (err: any) {
      send({ type: "result", instanceId: row.id, name: (row as any).agentName || (row as any).name || row.id, status: "fail", reason: err.message });
    }
  }

  send({ type: "complete", updated, total: targets.length });
  res.end();
});

app.post("/api/pool/refresh-versions", requireAuth, async (req, res) => {
  try {
    const { ids } = req.body || {};
    const rows = await db.getByStatus(["idle", "claimed"]);
    const targets = Array.isArray(ids) && ids.length > 0
      ? rows.filter((r) => ids.includes(r.id))
      : rows;
    let updated = 0;
    for (const row of targets) {
      if (!row.url) continue;
      try {
        const token = await db.getGatewayToken(row.id);
        const hcResult = await pool.healthCheck(row.url, token);
        if (hcResult.ok) {
          const hc = hcResult.data;
          console.log(`[pool] refresh-version ${row.id}: version=${hc.version ?? "null"} runtime=${hc.runtime ?? "null"}`);
          if (hc.version) {
            await db.setRuntimeVersion(row.id, hc.version, hc.runtime);
            updated++;
          }
        } else {
          console.log(`[pool] refresh-version ${row.id}: failed (${hcResult.reason})`);
        }
      } catch (err: any) {
        console.log(`[pool] refresh-version ${row.id}: url=${row.url} error=${err.message}`);
      }
    }
    console.log(`[pool] Refreshed versions for ${updated}/${targets.length} instances`);
    res.json({ ok: true, updated, total: targets.length });
  } catch (err: any) {
    console.error("[api] Refresh versions failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// Root redirect
app.get("/", (_req, res) => {
  res.redirect(302, config.templateSiteUrl);
});

// --- Admin dashboard (password-protected) ---
const POOL_ADMIN_URLS = config.poolAdminUrls.split(",").filter(Boolean).map((entry) => {
  const [env, url] = entry.split("=", 2);
  return { env: env?.trim() || "", url: url?.trim() || "" };
}).filter((e): e is { env: string; url: string } => !!e.env && !!e.url);

app.get("/admin", (req, res) => {
  if (!isAuthenticated(req)) { res.type("html").send(loginPage(null)); return; }
  res.type("html").send(dashboardPage({
    poolEnvironment: config.poolEnvironment,
    deployBranch: config.deployBranch,
    railwayServiceId: config.railwayServiceId,
    railwayProjectId: config.railwayProjectId,
    railwayEnvironmentId: config.railwayEnvironmentId,
    runtimeImage: config.railwayRuntimeImage,
    instanceModel: config.instanceModel,
    adminUrls: POOL_ADMIN_URLS as any,
    protectedInstances: config.protectedInstances,
  }));
});

app.get("/admin/dashboard", (_req, res) => res.redirect(302, "/admin"));

app.get("/admin/upgrades", (req, res) => {
  if (!isAuthenticated(req)) { res.redirect(302, "/admin"); return; }
  res.type("html").send(upgradesPage({
    poolEnvironment: config.poolEnvironment,
    railwayProjectId: config.railwayProjectId,
    railwayEnvironmentId: config.railwayEnvironmentId,
    runtimeImage: config.railwayRuntimeImage,
    adminUrls: POOL_ADMIN_URLS as any,
    protectedInstances: config.protectedInstances,
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

app.get("/admin/api-docs", (req, res) => {
  if (!isAuthenticated(req)) { res.redirect(302, "/admin"); return; }
  res.type("html").send(apiDocsPage({
    poolEnvironment: config.poolEnvironment,
    railwayProjectId: config.railwayProjectId,
    railwayEnvironmentId: config.railwayEnvironmentId,
    adminUrls: POOL_ADMIN_URLS as any,
  }));
});

// --- Pool management API ---
app.get("/api/pool/status", requireAuth, async (_req, res) => {
  const counts = await db.getCounts();
  const instances = await db.listAll();
  res.json({ counts, instances });
});

app.post("/api/pool/claim", requireAuth, async (req, res) => {
  const { agentName, instructions, joinUrl, profileImage, metadata, source } = req.body || {};
  if (instructions && typeof instructions !== "string") {
    res.status(400).json({ error: "instructions must be a string if provided" }); return;
  }
  if (agentName && typeof agentName !== "string") {
    res.status(400).json({ error: "agentName must be a string if provided" }); return;
  }
  if (joinUrl && typeof joinUrl !== "string") {
    res.status(400).json({ error: "joinUrl must be a string if provided" }); return;
  }
  if (profileImage && typeof profileImage !== "string") {
    res.status(400).json({ error: "profileImage must be a string if provided" }); return;
  }
  if (metadata && (typeof metadata !== "object" || Array.isArray(metadata))) {
    res.status(400).json({ error: "metadata must be an object if provided" }); return;
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
      profileImage: (typeof profileImage === "string" && profileImage) || undefined,
      metadata: metadata || undefined,
      source: (typeof source === "string" && source) || "api",
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
  const profileImage = (req.query.profileImage as string) || undefined;
  const source = (req.query.source as string) || "api";

  let metadata: Record<string, string> | undefined;
  if (req.query.metadata) {
    try {
      const parsed = JSON.parse(req.query.metadata as string);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        metadata = parsed;
      }
    } catch { /* ignore */ }
  }

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
      profileImage,
      metadata,
      source,
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
  const model = (req.query.model as string) || "";

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
        }, image || undefined, model || undefined);
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

// --- Notion prompt fetching (public) ---
const promptCache = new Map<string, { data: { name: string; prompt: string }; ts: number }>();
const PROMPT_CACHE_TTL = 60 * 60 * 1000;

async function fetchNotionPrompt(pageId: string) {
  const cached = promptCache.get(pageId);
  if (cached && Date.now() - cached.ts < PROMPT_CACHE_TTL) return cached.data;
  const headers: Record<string, string> = { "Authorization": `Bearer ${config.notionApiKey}`, "Notion-Version": "2022-06-28" };
  const blocksRes = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`, { headers });
  if (!blocksRes.ok) throw new Error(`Notion API ${blocksRes.status}`);
  const blocksData = await blocksRes.json() as any;
  let text = "";
  for (const block of blocksData.results || []) {
    if (block.type === "heading_1" || block.type === "heading_2" || block.type === "heading_3") {
      const prefix = block.type === "heading_1" ? "# " : block.type === "heading_2" ? "## " : "### ";
      const ht = block[block.type]?.rich_text;
      if (ht) text += prefix + ht.map((t: any) => t.plain_text).join("") + "\n";
    } else if (block.type === "bulleted_list_item" || block.type === "numbered_list_item") {
      const lt = block[block.type]?.rich_text;
      if (lt) text += "- " + lt.map((t: any) => t.plain_text).join("") + "\n";
    } else if (block.type === "divider") {
      text += "---\n";
    } else {
      const rt = block[block.type]?.rich_text;
      if (rt) text += rt.map((t: any) => t.plain_text).join("") + "\n";
    }
  }
  const pageRes = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers });
  let name = "";
  if (pageRes.ok) {
    const pageData = await pageRes.json() as any;
    const titleProp = Object.values(pageData.properties || {}).find((p: any) => p.type === "title") as any;
    if (titleProp) name = titleProp.title?.map((t: any) => t.plain_text).join("") || "";
  }
  const result = { name, prompt: text.trim() };
  promptCache.set(pageId, { data: result, ts: Date.now() });
  return result;
}

async function prefetchAllPrompts() {
  if (!config.notionApiKey) return;
  const catalog = JSON.parse(AGENT_CATALOG_JSON);
  const ids = catalog.map((a: any) => a.p).filter(Boolean);
  const uncached = ids.filter((id: string) => !promptCache.has(id));
  if (!uncached.length) return;
  console.log(`[prompts] Prefetching ${uncached.length} prompts...`);
  let done = 0;
  for (let i = 0; i < uncached.length; i += 3) {
    const batch = uncached.slice(i, i + 3);
    await Promise.allSettled(batch.map(async (id: string) => {
      try { await fetchNotionPrompt(id); done++; } catch {}
    }));
  }
  console.log(`[prompts] Prefetched ${done}/${uncached.length} prompts`);
}

app.get("/api/prompts/:pageId", async (req, res) => {
  const { pageId } = req.params;
  if (!pageId || !/^[a-f0-9]{32}$/.test(pageId)) {
    res.status(400).json({ error: "Invalid page ID" }); return;
  }
  if (!config.notionApiKey) {
    res.status(503).json({ error: "Notion API not configured" }); return;
  }
  try {
    res.json(await fetchNotionPrompt(pageId));
  } catch (err: any) {
    console.error("[api] Notion fetch failed:", err);
    res.status(502).json({ error: "Failed to fetch prompt from Notion" });
  }
});

// --- Services routes (previously separate service, now local) ---
app.use(registryRouter); // registry is public
app.use(requireAuth, dashboardRouter);
app.use(requireAuth, infraRouter);
app.use(requireAuth, statusRouter);
app.use(requireAuth, configureRouter);
app.use(requireAuth, toolsRouter);

// --- Startup: migrate, register webhook, start server ---
import { runMigrations } from "./db/migrate";

// --- Metrics ---
initMetrics();

runMigrations()
  .then(() => {
    setTimeout(() => prefetchAllPrompts().catch(() => {}), 5000);
    ensureWebhookRule().catch((err) =>
      console.warn("[startup] Webhook rule registration failed:", err.message));
  })
  .catch((err) => {
    console.error("[startup] Migration failed:", err);
    process.exit(1);
  });

app.listen(config.port, () => {
  console.log(`Pool manager listening on :${config.port}`);
  // Seed catalog on first boot
  seedCatalog().catch((e) => console.error("[seed] Catalog seed failed:", e));
});
