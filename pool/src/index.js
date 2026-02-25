import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import * as pool from "./pool.js";
import * as db from "./db/pool.js";
import { migrate } from "./db/migrate.js";
import { adminLogin, adminLogout, isAuthenticated, loginPage, adminPage } from "./admin.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT || "3001", 10);
const POOL_API_KEY = process.env.POOL_API_KEY;
const POOL_ENVIRONMENT = process.env.POOL_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_NAME || "undefined";
// Deploy context shown in dashboard info tags
const DEPLOY_BRANCH = process.env.RAILWAY_SOURCE_BRANCH || process.env.RAILWAY_GIT_BRANCH || "unknown";
const INSTANCE_MODEL = process.env.OPENCLAW_PRIMARY_MODEL || "unknown";
const RAILWAY_PROJECT_ID = process.env.RAILWAY_PROJECT_ID || "";
const RAILWAY_SERVICE_ID = process.env.RAILWAY_SERVICE_ID || "";
const RAILWAY_ENVIRONMENT_ID = process.env.RAILWAY_ENVIRONMENT_ID || "";
const NOTION_API_KEY = process.env.NOTION_API_KEY || "";

// --- Notion prompt cache (1 hour TTL) ---
const promptCache = new Map();
const PROMPT_CACHE_TTL = 60 * 60 * 1000;

// --- Agent catalog for prompt store ---
const AGENT_CATALOG_JSON = (() => {
  try {
    const catalogPath = resolve(__dirname, "agents-data.json");
    const raw = JSON.parse(readFileSync(catalogPath, "utf8"));
    const compact = raw.map(a => {
      const url = a.subPageUrl || "";
      const m = url.match(/([a-f0-9]{32})/);
      const catParts = (a.category || "").split(" — ");
      const emoji = catParts[0].trim().split(" ")[0];
      let catName = catParts[0].trim().replace(/^\S+\s/, "").replace(/\s*&\s*.+$/, "");
      if (catName === "Superpower Agents") catName = "Superpowers";
      if (catName === "Neighborhood") catName = "Local";
      if (catName === "Professional") catName = "Work";
      return { n: a.name, d: a.description, c: catName, e: emoji, p: m ? m[1] : "", s: a.status };
    }).filter(a => a.n && a.p);
    return JSON.stringify(compact);
  } catch (e) {
    console.warn("[pool] Could not load agents catalog:", e.message);
    return "[]";
  }
})();

// --- Agent catalog for template site (full objects, not compact) ---
function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const AGENT_CATALOG = (() => {
  try {
    const catalogPath = resolve(__dirname, "agents-data.json");
    const raw = JSON.parse(readFileSync(catalogPath, "utf8"));
    return raw.filter((a) => a.name).map((a) => {
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
    }).filter((a) => a.notionPageId);
  } catch (e) {
    console.warn("[pool] Could not load agents catalog:", e.message);
    return [];
  }
})();

const app = express();
app.disable("x-powered-by");
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// --- CORS for template site ---
app.use((req, res, next) => {
  const origin = req.headers.origin || "";
  const allowed = (process.env.TEMPLATE_SITE_ORIGINS || "http://localhost:3000").split(",").map((u) => u.trim());
  if (origin && allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// --- Auth middleware ---
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match || match[1] !== POOL_API_KEY) {
    return res.status(401).json({ error: "Invalid or missing API key" });
  }
  return next();
}

// --- Routes ---

app.get("/favicon.ico", (_req, res) => res.sendFile(join(__dirname, "favicon.ico")));
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// Version — check this to verify what code is deployed.
const BUILD_VERSION = "2026-02-24T01:db-instances-v1";
app.get("/version", (_req, res) => res.json({ version: BUILD_VERSION, environment: POOL_ENVIRONMENT }));

// Pool counts (no auth — used by the launch form)
app.get("/api/pool/counts", async (_req, res) => {
  res.json(await db.getCounts());
});

// Convert snake_case DB row to camelCase for the frontend.
function camelRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = v;
  }
  return out;
}

// List launched agents (no auth — used by the page)
app.get("/api/pool/agents", async (_req, res) => {
  const claimed = (await db.getByStatus("claimed")).map(camelRow);
  const crashed = (await db.getByStatus("crashed")).map(camelRow);
  const idle = (await db.getByStatus("idle")).map(camelRow);
  const starting = (await db.getByStatus("starting")).map(camelRow);
  res.json({ claimed, crashed, idle, starting });
});

// Template catalog (no auth — public-facing for template site)
app.get("/api/pool/info", (_req, res) => {
  res.json({
    environment: POOL_ENVIRONMENT,
    branch: DEPLOY_BRANCH,
    model: INSTANCE_MODEL,
    railwayProjectId: RAILWAY_PROJECT_ID,
    railwayServiceId: RAILWAY_SERVICE_ID,
    railwayEnvironmentId: RAILWAY_ENVIRONMENT_ID,
  });
});

app.get("/api/pool/templates", (_req, res) => { res.json(AGENT_CATALOG); });
app.get("/api/pool/templates/:slug", (req, res) => {
  const t = AGENT_CATALOG.find((a) => a.slug === req.params.slug);
  if (!t) return res.status(404).json({ error: "Template not found" });
  res.json(t);
});

// Kill a launched instance
app.delete("/api/pool/instances/:id", requireAuth, async (req, res) => {
  try {
    await pool.killInstance(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("[api] Kill failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// Dismiss a crashed agent
app.delete("/api/pool/crashed/:id", requireAuth, async (req, res) => {
  try {
    await pool.dismissCrashed(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("[api] Dismiss failed:", err);
    res.status(500).json({ error: err.message });
  }
});


// Root redirect — template site handles the public-facing homepage
app.get("/", (_req, res) => {
  res.redirect(302, process.env.TEMPLATE_SITE_URL || "https://assistants.convos.org");
});

// Admin environment links
const POOL_ADMIN_URLS = (process.env.POOL_ADMIN_URLS || "dev=https://convos-agents-dev.up.railway.app,staging=https://convos-agents-staging.up.railway.app,production=https://convos-agents-production.up.railway.app").split(",").filter(Boolean).map((entry) => {
  const [env, url] = entry.split("=", 2);
  return { env: env?.trim() || "", url: url?.trim() || "" };
}).filter((e) => e.env && e.url);

// --- Admin dashboard (password-protected) ---
app.get("/admin", (req, res) => {
  if (!isAuthenticated(req)) return res.type("html").send(loginPage());
  res.type("html").send(adminPage({
    poolEnvironment: POOL_ENVIRONMENT,
    deployBranch: DEPLOY_BRANCH,
    instanceModel: INSTANCE_MODEL,
    railwayProjectId: RAILWAY_PROJECT_ID,
    railwayServiceId: RAILWAY_SERVICE_ID,
    railwayEnvironmentId: RAILWAY_ENVIRONMENT_ID,
    poolApiKey: POOL_API_KEY,
    adminUrls: POOL_ADMIN_URLS,
  }));
});

app.post("/admin/login", (req, res) => {
  const { password } = req.body || {};
  if (adminLogin(password, res)) return res.redirect(302, "/admin");
  res.type("html").send(loginPage("Invalid API key"));
});

app.post("/admin/logout", (req, res) => {
  adminLogout(req, res);
  res.redirect(302, "/admin");
});


// Pool status overview
app.get("/api/pool/status", requireAuth, async (_req, res) => {
  const counts = await db.getCounts();
  const instances = await db.listAll();
  res.json({ counts, instances });
});

// Launch an agent — claim an idle instance and provision it with instructions.
app.post("/api/pool/claim", requireAuth, async (req, res) => {
  const { agentName, instructions, joinUrl } = req.body || {};
  if (instructions && typeof instructions !== "string") {
    return res.status(400).json({ error: "instructions must be a string if provided" });
  }
  if (agentName && typeof agentName !== "string") {
    return res.status(400).json({ error: "agentName must be a string if provided" });
  }
  if (joinUrl && typeof joinUrl !== "string") {
    return res.status(400).json({ error: "joinUrl must be a string if provided" });
  }
  if (joinUrl && POOL_ENVIRONMENT === "production" && /dev\.convos\.org/i.test(joinUrl)) {
    return res.status(400).json({ error: "dev.convos.org links cannot be used in the production environment" });
  }
  if (joinUrl && POOL_ENVIRONMENT !== "production" && /popup\.convos\.org/i.test(joinUrl)) {
    return res.status(400).json({ error: `popup.convos.org links cannot be used in the ${POOL_ENVIRONMENT} environment` });
  }

  try {
    const result = await pool.provision({
      agentName: agentName || "Assistant",
      instructions: instructions || "You are a helpful AI assistant.",
      joinUrl: joinUrl || undefined,
    });
    if (!result) {
      return res.status(503).json({
        error: "No idle instances available. Try again in a few minutes.",
      });
    }
    res.json(result);
  } catch (err) {
    console.error("[api] Launch failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// Manually trigger a replenish cycle, optionally creating N instances
app.post("/api/pool/replenish", requireAuth, async (req, res) => {
  try {
    const count = Math.min(parseInt(req.body?.count) || 0, 20);
    if (count > 0) {
      const results = [];
      for (let i = 0; i < count; i++) {
        try {
          const inst = await pool.createInstance();
          results.push(inst);
        } catch (err) {
          console.error(`[pool] Failed to create instance:`, err);
        }
      }
      return res.json({ ok: true, created: results.length, counts: await db.getCounts() });
    }
    await pool.tick();
    res.json({ ok: true, counts: await db.getCounts() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manually trigger a tick (replaces old reconcile endpoint)
app.post("/api/pool/reconcile", requireAuth, async (_req, res) => {
  try {
    await pool.tick();
    res.json({ ok: true, counts: await db.getCounts() });
  } catch (err) {
    console.error("[api] Tick failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// Drain unclaimed instances from the pool
app.post("/api/pool/drain", requireAuth, async (req, res) => {
  try {
    const count = Math.min(parseInt(req.body?.count) || 1, 20);
    const drained = await pool.drainPool(count);
    res.json({ ok: true, drained: drained.length, counts: await db.getCounts() });
  } catch (err) {
    console.error("[api] Drain failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- Notion prompt fetching ---
async function fetchNotionPrompt(pageId) {
  const cached = promptCache.get(pageId);
  if (cached && Date.now() - cached.ts < PROMPT_CACHE_TTL) return cached.data;
  const headers = { "Authorization": `Bearer ${NOTION_API_KEY}`, "Notion-Version": "2022-06-28" };
  const blocksRes = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`, { headers });
  if (!blocksRes.ok) throw new Error(`Notion API ${blocksRes.status}`);
  const blocksData = await blocksRes.json();
  let text = "";
  for (const block of blocksData.results || []) {
    if (block.type === "heading_1" || block.type === "heading_2" || block.type === "heading_3") {
      const prefix = block.type === "heading_1" ? "# " : block.type === "heading_2" ? "## " : "### ";
      const ht = block[block.type]?.rich_text;
      if (ht) text += prefix + ht.map(t => t.plain_text).join("") + "\n";
    } else if (block.type === "bulleted_list_item" || block.type === "numbered_list_item") {
      const lt = block[block.type]?.rich_text;
      if (lt) text += "- " + lt.map(t => t.plain_text).join("") + "\n";
    } else if (block.type === "divider") {
      text += "---\n";
    } else {
      const rt = block[block.type]?.rich_text;
      if (rt) text += rt.map(t => t.plain_text).join("") + "\n";
    }
  }
  const pageRes = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers });
  let name = "";
  if (pageRes.ok) {
    const pageData = await pageRes.json();
    const titleProp = Object.values(pageData.properties || {}).find(p => p.type === "title");
    if (titleProp) name = titleProp.title?.map(t => t.plain_text).join("") || "";
  }
  const result = { name, prompt: text.trim() };
  promptCache.set(pageId, { data: result, ts: Date.now() });
  return result;
}

// Prefetch all agent prompts in background (3 concurrent)
async function prefetchAllPrompts() {
  if (!NOTION_API_KEY) return;
  const catalog = JSON.parse(AGENT_CATALOG_JSON);
  const ids = catalog.map(a => a.p).filter(Boolean);
  const uncached = ids.filter(id => !promptCache.has(id));
  if (!uncached.length) return;
  console.log(`[prompts] Prefetching ${uncached.length} prompts...`);
  let done = 0;
  for (let i = 0; i < uncached.length; i += 3) {
    const batch = uncached.slice(i, i + 3);
    await Promise.allSettled(batch.map(async id => {
      try { await fetchNotionPrompt(id); done++; } catch {}
    }));
  }
  console.log(`[prompts] Prefetched ${done}/${uncached.length} prompts`);
}

app.get("/api/prompts/:pageId", async (req, res) => {
  const { pageId } = req.params;
  if (!pageId || !/^[a-f0-9]{32}$/.test(pageId)) {
    return res.status(400).json({ error: "Invalid page ID" });
  }
  if (!NOTION_API_KEY) {
    return res.status(503).json({ error: "Notion API not configured" });
  }
  try {
    res.json(await fetchNotionPrompt(pageId));
  } catch (err) {
    console.error("[api] Notion fetch failed:", err);
    res.status(502).json({ error: "Failed to fetch prompt from Notion" });
  }
});

// --- Background tick ---
// Reconcile DB from Railway + health checks every 30 seconds.
const TICK_INTERVAL = parseInt(process.env.TICK_INTERVAL_MS || "30000", 10);
setInterval(() => {
  pool.tick().catch((err) => console.error("[tick] Error:", err));
}, TICK_INTERVAL);

// Run migrations (idempotent), then initial tick
migrate()
  .then(() => pool.tick())
  .catch((err) => console.error("[tick] Initial tick error:", err));

// Prefetch all Notion prompts in background so Copy is instant
setTimeout(() => prefetchAllPrompts().catch(() => {}), 5000);

app.listen(PORT, () => {
  console.log(`Pool manager listening on :${PORT}`);
});
