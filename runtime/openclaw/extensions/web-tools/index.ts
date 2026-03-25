import type { ServerResponse } from "node:http";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import * as fs from "node:fs";
import * as path from "node:path";

function serveFile(
  res: ServerResponse,
  filePath: string,
  contentType: string,
  cacheControl?: string,
) {
  try {
    const body = fs.readFileSync(filePath);
    res.statusCode = 200;
    res.setHeader("Content-Type", contentType);
    if (cacheControl) res.setHeader("Cache-Control", cacheControl);
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end();
  }
}

/** Read OPENCLAW_GATEWAY_TOKEN from env so pages can auth to convos endpoints. */
function getGatewayToken(): string {
  return process.env.OPENCLAW_GATEWAY_TOKEN || "";
}

/** Serve an HTML page with the gateway token injected as a JS variable. */
function servePageWithToken(htmlPath: string, res: ServerResponse) {
  try {
    let html = fs.readFileSync(htmlPath, "utf-8");
    const token = getGatewayToken();
    // Inject token before the closing </head> tag so it's available to scripts
    const injection = `<script>window.__POOL_TOKEN=${JSON.stringify(token)};</script>`;
    html = html.replace("</head>", injection + "\n</head>");
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(html);
  } catch {
    res.statusCode = 404;
    res.end();
  }
}

/** Serve the landing page with the gateway token injected as a JS variable. */
function serveLandingPage(agentsDir: string, res: ServerResponse) {
  servePageWithToken(path.join(agentsDir, "landing.html"), res);
}

/** Build service identity + credits data from pool proxy (or env fallback). */
async function getServicesData(): Promise<Record<string, unknown>> {
  const servicesUrl = buildServicesUrl();
  const instanceId = process.env.INSTANCE_ID || null;
  const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;
  const poolUrl = process.env.POOL_URL;

  let email: string | null = null;
  let phone: string | null = null;

  // Fetch identity from pool proxy (production) or fall back to env (local dev)
  if (instanceId && gatewayToken && poolUrl) {
    try {
      const infoRes = await fetch(`${poolUrl}/api/proxy/info`, {
        headers: { Authorization: `Bearer ${instanceId}:${gatewayToken}` },
        signal: AbortSignal.timeout(5_000),
      });
      if (infoRes.ok) {
        const info = await infoRes.json() as { email?: string; phone?: string };
        email = info.email || null;
        phone = info.phone || null;
      }
    } catch {}
  }
  // Direct mode fallback (local dev / QA only — live agents always use proxy)
  if (!email) email = process.env.AGENTMAIL_INBOX_ID || null;
  if (!phone) phone = process.env.TELNYX_PHONE_NUMBER || null;

  // Show shortened pool URL so the user can tell if they're hitting localhost or Railway
  const poolHost = poolUrl ? new URL(poolUrl).host : null;
  const result: Record<string, unknown> = { email, phone, servicesUrl, instanceId, poolHost };

  // Fetch runtime version/image from pool
  if (instanceId && gatewayToken && poolUrl) {
    try {
      const selfInfoRes = await fetch(`${poolUrl}/api/pool/self-info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instanceId, gatewayToken }),
        signal: AbortSignal.timeout(5_000),
      });
      if (selfInfoRes.ok) {
        const selfInfo = await selfInfoRes.json() as { runtimeVersion?: string; runtimeImage?: string };
        result.runtimeVersion = selfInfo.runtimeVersion || null;
        result.runtimeImage = selfInfo.runtimeImage || null;
      }
    } catch {}
  }

  if (instanceId && gatewayToken && poolUrl) {
    try {
      const creditsUrl = `${poolUrl}/api/pool/credits-check`;
      console.log(`[web-tools] Credits check → ${creditsUrl} (instance=${instanceId})`);
      const creditsRes = await fetch(creditsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instanceId, gatewayToken }),
        signal: AbortSignal.timeout(5_000),
      });
      if (creditsRes.ok) {
        result.credits = await creditsRes.json();
      } else {
        const body = await creditsRes.text().catch(() => "");
        console.warn(`[web-tools] Credits check failed: ${creditsRes.status} ${body}`);
        result.credits = { error: "unavailable" };
      }
    } catch (err: any) {
      console.warn(`[web-tools] Credits check error: ${err.message}`);
      result.credits = { error: "unavailable" };
    }
  } else {
    result.credits = { error: "not pool-managed" };
  }

  return result;
}

function buildServicesUrl(): string {
  const domain = process.env.RAILWAY_PUBLIC_DOMAIN;
  const ngrok = process.env.NGROK_URL;
  const port = process.env.POOL_SERVER_PORT || process.env.PORT || "18789";
  const base = domain
    ? `https://${domain}`
    : ngrok
      ? ngrok.replace(/\/$/, "")
      : `http://127.0.0.1:${port}`;
  return `${base}/web-tools/services`;
}

/** Resolve the skills data directory ($SKILLS_ROOT/generated/). */
function getSkillsDataPath(): string {
  const skillsRoot = process.env.SKILLS_ROOT
    || path.join(process.env.OPENCLAW_STATE_DIR || path.join(process.env.HOME || "", ".openclaw"), "workspace", "skills");
  return path.join(skillsRoot, "generated");
}

/** Read the full skills.json data. */
function readSkillsData(): { active: string | null; skills: Record<string, unknown>[] } | null {
  const jsonPath = path.join(getSkillsDataPath(), "skills.json");
  try {
    const raw = fs.readFileSync(jsonPath, "utf-8");
    const data = JSON.parse(raw);
    if (!Array.isArray(data.skills)) return null;
    return data;
  } catch {
    return null;
  }
}

/** Read skills.json and return a single skill by slug. */
function readSkillBySlug(slug: string): Record<string, unknown> | null {
  const data = readSkillsData();
  if (!data) return null;
  return data.skills.find((s: any) => s.slug === slug) as Record<string, unknown> || null;
}

export default function register(api: OpenClawPluginApi) {
  // Docker: /app/web-tools/. Local: apply-config.sh copies to STATE_DIR/web-tools/.
  const stateWebTools = path.join(process.env.OPENCLAW_STATE_DIR || path.join(process.env.HOME || "", ".openclaw"), "web-tools");
  const sharedRoot = fs.existsSync("/app/web-tools") ? "/app/web-tools"
    : fs.existsSync(stateWebTools) ? stateWebTools
    : __dirname;
  const agentsDir = path.resolve(sharedRoot, "convos");
  const servicesDir = path.resolve(sharedRoot, "services");
  const skillsDir = path.resolve(sharedRoot, "skills");

  api.registerHttpRoute({
    path: "/web-tools/convos",
    auth: "plugin",
    handler: async (req, res) => {
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.end();
        return;
      }
      serveLandingPage(agentsDir, res);
    },
  });

  api.registerHttpRoute({
    path: "/web-tools/convos/",
    auth: "plugin",
    handler: async (req, res) => {
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.end();
        return;
      }
      serveLandingPage(agentsDir, res);
    },
  });

  api.registerHttpRoute({
    path: "/web-tools/convos/manifest.json",
    auth: "plugin",
    handler: async (req, res) => {
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.end();
        return;
      }
      serveFile(
        res,
        path.join(agentsDir, "landing-manifest.json"),
        "application/manifest+json",
      );
    },
  });

  api.registerHttpRoute({
    path: "/web-tools/convos/sw.js",
    auth: "plugin",
    handler: async (req, res) => {
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.end();
        return;
      }
      serveFile(
        res,
        path.join(agentsDir, "sw.js"),
        "application/javascript",
        "max-age=0",
      );
    },
  });

  api.registerHttpRoute({
    path: "/web-tools/convos/landing.css",
    auth: "plugin",
    handler: async (req, res) => {
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.end();
        return;
      }
      serveFile(res, path.join(agentsDir, "landing.css"), "text/css", "max-age=3600");
    },
  });

  api.registerHttpRoute({
    path: "/web-tools/convos/icon.svg",
    auth: "plugin",
    handler: async (req, res) => {
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.end();
        return;
      }
      serveFile(res, path.join(agentsDir, "icon.svg"), "image/svg+xml");
    },
  });

  // --- Services page ---

  api.registerHttpRoute({
    path: "/web-tools/services",
    auth: "plugin",
    handler: async (req, res) => {
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.end();
        return;
      }
      servePageWithToken(path.join(servicesDir, "services.html"), res);
    },
  });

  api.registerHttpRoute({
    path: "/web-tools/services/",
    auth: "plugin",
    handler: async (req, res) => {
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.end();
        return;
      }
      servePageWithToken(path.join(servicesDir, "services.html"), res);
    },
  });

  api.registerHttpRoute({
    path: "/web-tools/services/api",
    auth: "plugin",
    handler: async (req, res) => {
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.end();
        return;
      }
      try {
        const data = await getServicesData();
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify(data));
      } catch {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Failed to load services data" }));
      }
    },
  });

  // Serve extracted CSS for services page
  api.registerHttpRoute({
    path: "/web-tools/services/services.css",
    auth: "plugin",
    handler: async (req, res) => {
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.end();
        return;
      }
      serveFile(res, path.join(servicesDir, "services.css"), "text/css", "max-age=3600");
    },
  });

  // Credits top-up proxy — forwards request to pool manager
  api.registerHttpRoute({
    path: "/web-tools/services/topup",
    auth: "plugin",
    handler: async (req, res) => {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.end();
        return;
      }

      const instanceId = process.env.INSTANCE_ID;
      const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;
      const poolUrl = process.env.POOL_URL;

      if (!instanceId || !gatewayToken || !poolUrl) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Top-up not available (missing config)" }));
        return;
      }

      try {
        const topupUrl = `${poolUrl}/api/pool/credits-topup`;
        console.log(`[web-tools] Credits top-up → ${topupUrl} (instance=${instanceId})`);
        const poolRes = await fetch(topupUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instanceId, gatewayToken }),
          signal: AbortSignal.timeout(10_000),
        });
        const body = await poolRes.json().catch(() => ({ error: "Invalid response" }));
        res.statusCode = poolRes.status;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(body));
      } catch (err: any) {
        console.warn(`[web-tools] Credits top-up error: ${err.message}`);
        res.statusCode = 502;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Failed to reach pool manager" }));
      }
    },
  });

  // Coupon redemption proxy — forwards request to pool manager
  api.registerHttpRoute({
    path: "/web-tools/services/redeem-coupon",
    auth: "plugin",
    handler: async (req, res) => {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.end();
        return;
      }

      const instanceId = process.env.INSTANCE_ID;
      const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;
      const poolUrl = process.env.POOL_URL;

      if (!instanceId || !gatewayToken || !poolUrl) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Coupon redemption not available" }));
        return;
      }

      try {
        // Read body from request
        let body = "";
        await new Promise<void>((resolve) => {
          req.on("data", (chunk: Buffer) => {
            body += chunk.toString();
          });
          req.on("end", resolve);
        });
        const parsed = JSON.parse(body || "{}");

        const poolRes = await fetch(`${poolUrl}/api/pool/redeem-coupon`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instanceId, gatewayToken, code: parsed.code }),
          signal: AbortSignal.timeout(10_000),
        });
        const result = await poolRes.json().catch(() => ({ error: "Invalid response" }));
        res.statusCode = poolRes.status;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(result));
      } catch (err: any) {
        console.warn(`[web-tools] Coupon redemption error: ${err.message}`);
        res.statusCode = 502;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Failed to reach server" }));
      }
    },
  });

  // --- Trajectories / logs ---

  const trajDir = path.resolve(sharedRoot, "trajectories");
  const stateDir = process.env.OPENCLAW_STATE_DIR || path.join(process.env.HOME || "", ".openclaw");

  function isSharingEnabled(): boolean {
    return fs.existsSync(path.join(stateDir, ".share-trajectories"));
  }

  /** Read OpenClaw session JSONL files and normalize to trajectory format. */
  function readSessionTrajectories(maxEntries = 200): Record<string, unknown>[] {
    const sessionsDir = path.join(stateDir, "agents", "main", "sessions");
    const indexPath = path.join(sessionsDir, "sessions.json");
    const entries: Record<string, unknown>[] = [];

    // Read the sessions.json index to find session IDs
    let index: Record<string, { sessionId?: string; updatedAt?: number }>;
    try {
      index = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    } catch {
      return entries;
    }

    // Collect session IDs and their metadata
    const sessions: { key: string; sessionId: string; updatedAt: number }[] = [];
    for (const [key, val] of Object.entries(index)) {
      if (val && typeof val === "object" && val.sessionId) {
        sessions.push({
          key,
          sessionId: val.sessionId,
          updatedAt: val.updatedAt || 0,
        });
      }
    }

    // Sort by most recent first
    sessions.sort((a, b) => b.updatedAt - a.updatedAt);

    // Read each session's JSONL file
    for (const sess of sessions.slice(0, maxEntries)) {
      const jsonlPath = path.join(sessionsDir, `${sess.sessionId}.jsonl`);
      try {
        if (!fs.existsSync(jsonlPath)) continue;
        const lines = fs.readFileSync(jsonlPath, "utf-8").split("\n").filter(Boolean);
        const conversations: Record<string, unknown>[] = [];
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            // Normalize OpenClaw session entries to {from, value} format
            const role = parsed.role || "unknown";
            const content = parsed.content || parsed.text || "";
            conversations.push({ from: role, value: typeof content === "string" ? content : JSON.stringify(content) });
          } catch { /* skip bad lines */ }
        }
        if (conversations.length > 0) {
          entries.push({
            conversations,
            timestamp: sess.updatedAt ? new Date(sess.updatedAt).toISOString() : undefined,
            model: undefined,
            completed: true,
            sessionKey: sess.key,
            sessionId: sess.sessionId,
          });
        }
      } catch { /* skip unreadable sessions */ }
    }

    return entries;
  }

  api.registerHttpRoute({
    path: "/web-tools/trajectories",
    match: "prefix",
    auth: "plugin",
    handler: async (req, res) => {
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.end();
        return;
      }

      const url = new URL(req.url || "", "http://localhost");
      const pathParts = url.pathname.replace(/\/+$/, "").split("/");
      const lastPart = pathParts[pathParts.length - 1];

      // CSS
      if (lastPart === "trajectories.css") {
        serveFile(res, path.join(trajDir, "trajectories.css"), "text/css", "max-age=3600");
        return;
      }

      // API
      if (lastPart === "api") {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        if (!isSharingEnabled()) {
          res.statusCode = 403;
          res.end(JSON.stringify({ error: "sharing not enabled" }));
          return;
        }
        const entries = readSessionTrajectories();
        res.statusCode = 200;
        res.end(JSON.stringify({ runtime: "openclaw", entries }));
        return;
      }

      // Page
      serveFile(res, path.join(trajDir, "trajectories.html"), "text/html; charset=utf-8");
    },
  });

  // --- Skills pages ---

  // Serve skill page HTML for any slug: /web-tools/skills/<slug>
  api.registerHttpRoute({
    path: "/web-tools/skills",
    match: "prefix",
    auth: "plugin",
    handler: async (req, res) => {
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.end();
        return;
      }
      // Extract slug from the URL path (everything after /web-tools/skills/)
      const url = new URL(req.url || "", "http://localhost");
      const pathParts = url.pathname.replace(/\/+$/, "").split("/");
      const lastPart = pathParts[pathParts.length - 1];

      // Static asset: skills.css
      if (lastPart === "skills.css") {
        serveFile(res, path.join(skillsDir, "skills.css"), "text/css", "max-age=3600");
        return;
      }

      // API: /web-tools/skills/api — list all skills
      if (lastPart === "api" && pathParts[pathParts.length - 2] === "skills") {
        const data = readSkillsData();
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.statusCode = 200;
        res.end(JSON.stringify(data || { active: null, skills: [] }));
        return;
      }

      // API: /web-tools/skills/api/<slug> — single skill
      if (pathParts.length >= 5 && pathParts[pathParts.length - 2] === "api") {
        let slug: string;
        try { slug = decodeURIComponent(lastPart); } catch {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "invalid slug" }));
          return;
        }
        const skill = readSkillBySlug(slug);
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        if (skill) {
          res.statusCode = 200;
          res.end(JSON.stringify(skill));
        } else {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: "skill not found" }));
        }
        return;
      }

      // Index page: /web-tools/skills (no slug or just trailing slash)
      if (lastPart === "skills") {
        serveFile(res, path.join(skillsDir, "index.html"), "text/html; charset=utf-8");
        return;
      }

      // Skill detail page: /web-tools/skills/<slug>
      serveFile(res, path.join(skillsDir, "skill.html"), "text/html; charset=utf-8");
    },
  });
}
