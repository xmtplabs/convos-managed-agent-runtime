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

/** Read GATEWAY_TOKEN from env so pages can auth to convos endpoints. */
function getGatewayToken(): string {
  return process.env.GATEWAY_TOKEN || "";
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
/** Build service identity + credits data from pool proxy (or env fallback). */
async function getServicesData(): Promise<Record<string, unknown>> {
  const servicesUrl = buildServicesUrl();
  const instanceId = process.env.INSTANCE_ID || null;
  const gatewayToken = process.env.GATEWAY_TOKEN;
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
  const result: Record<string, unknown> = { email, phone, servicesUrl, instanceId, runtimeType: "openclaw", xmtpEnv: process.env.XMTP_ENV || "" };

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
  const port = process.env.POOL_SERVER_PORT || process.env.PORT || "18789";
  const base = domain ? `https://${domain}` : `http://127.0.0.1:${port}`;
  return `${base}/web-tools`;
}

/** Resolve the skills data directory ($WORKSPACE_SKILLS/generated/). */
function getSkillsDataPath(): string {
  const wsSkills = process.env.WORKSPACE_SKILLS
    || path.join(process.env.OPENCLAW_STATE_DIR || path.join(process.env.HOME || "", ".openclaw"), "workspace", "skills");
  return path.join(wsSkills, "generated");
}

/** Parse YAML frontmatter from a SKILL.md file (simple key: value parser). */
function parseSkillFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  let currentKey = "";
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (kv) {
      currentKey = kv[1];
      const val = kv[2].trim();
      // Handle YAML multiline indicator (|)
      result[currentKey] = val === "|" ? "" : val;
    } else if (currentKey && line.startsWith("  ")) {
      // Continuation of multiline value
      result[currentKey] = (result[currentKey] ? result[currentKey] + "\n" : "") + line.trim();
    }
  }
  return result;
}

/** Read skills from $ROOT_SKILLS or $OPENCLAW_STATE_DIR/skills/ directories (each has SKILL.md). */
function readSkillsFromDirs(): { active: string | null; skills: Record<string, unknown>[] } {
  const rootSkills = process.env.ROOT_SKILLS
    || path.join(process.env.OPENCLAW_STATE_DIR || path.join(process.env.HOME || "", ".openclaw"), "skills");
  const skills: Record<string, unknown>[] = [];
  try {
    const dirs = fs.readdirSync(rootSkills, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const dir of dirs) {
      const skillMdPath = path.join(rootSkills, dir.name, "SKILL.md");
      try {
        const raw = fs.readFileSync(skillMdPath, "utf-8");
        const fm = parseSkillFrontmatter(raw);
        skills.push({
          slug: dir.name,
          agentName: fm.name || dir.name,
          description: fm.description || "",
          emoji: fm.emoji || "",
          category: fm.category || "",
          prompt: raw.replace(/^---[\s\S]*?---\n*/, ""),
          tools: fm.tools ? fm.tools.split(",").map((t: string) => t.trim()) : [],
        });
      } catch {}
    }
  } catch {}
  return { active: null, skills };
}

/** Read the full skills.json data, merged with root skill directories. */
function readSkillsData(): { active: string | null; skills: Record<string, unknown>[] } | null {
  const allSkills: Record<string, unknown>[] = [];
  let active: string | null = null;

  // 1. Root skills from SKILL.md directories (always included)
  const fromDirs = readSkillsFromDirs();
  allSkills.push(...fromDirs.skills);

  // 2. Generated skills from skills.json (merged on top)
  const jsonPath = path.join(getSkillsDataPath(), "skills.json");
  try {
    const raw = fs.readFileSync(jsonPath, "utf-8");
    const data = JSON.parse(raw);
    if (Array.isArray(data.skills)) {
      const rootSlugs = new Set(allSkills.map(s => s.slug));
      for (const s of data.skills) {
        if (!rootSlugs.has(s.slug)) allSkills.push(s);
      }
    }
    if (data.active) active = data.active;
  } catch {}

  return allSkills.length > 0 ? { active, skills: allSkills } : null;
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
  const logsDir = path.resolve(sharedRoot, "logs");

  // --- Mini-app at /web-tools/ ---

  const appHandler = async (req: any, res: any) => {
    if (req.method !== "GET") { res.statusCode = 405; res.end(); return; }
    servePageWithToken(path.join(sharedRoot, "index.html"), res);
  };

  api.registerHttpRoute({ path: "/web-tools", auth: "plugin", handler: appHandler });
  api.registerHttpRoute({ path: "/web-tools/", auth: "plugin", handler: appHandler });

  api.registerHttpRoute({
    path: "/web-tools/app.css",
    auth: "plugin",
    handler: async (req, res) => {
      if (req.method !== "GET") { res.statusCode = 405; res.end(); return; }
      serveFile(res, path.join(sharedRoot, "app.css"), "text/css", "max-age=3600");
    },
  });

  // --- Services page (backward compat → same mini-app) ---

  api.registerHttpRoute({ path: "/web-tools/services", auth: "plugin", handler: appHandler });
  api.registerHttpRoute({ path: "/web-tools/services/", auth: "plugin", handler: appHandler });
  api.registerHttpRoute({ path: "/web-tools/tasks", auth: "plugin", handler: appHandler });
  api.registerHttpRoute({ path: "/web-tools/context", auth: "plugin", handler: appHandler });
  api.registerHttpRoute({ path: "/web-tools/notes", auth: "plugin", handler: appHandler });

  api.registerHttpRoute({
    path: "/web-tools/api/services",
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

  // Credits top-up proxy — forwards request to pool manager
  api.registerHttpRoute({
    path: "/web-tools/api/topup",
    auth: "plugin",
    handler: async (req, res) => {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.end();
        return;
      }

      const instanceId = process.env.INSTANCE_ID;
      const gatewayToken = process.env.GATEWAY_TOKEN;
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
    path: "/web-tools/api/redeem-coupon",
    auth: "plugin",
    handler: async (req, res) => {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.end();
        return;
      }

      const instanceId = process.env.INSTANCE_ID;
      const gatewayToken = process.env.GATEWAY_TOKEN;
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

  // --- Context API (reads from runtime workspace) ---

  /** Read .md files from the runtime workspace directory ($OPENCLAW_STATE_DIR/workspace/). */
  function readWorkspaceFiles(): { name: string; content: string }[] {
    const wsDir = path.join(
      process.env.OPENCLAW_STATE_DIR || path.join(process.env.HOME || "", ".openclaw"),
      "workspace",
    );
    const files: { name: string; content: string }[] = [];
    try {
      const NATIVE_FILES = new Set(["AGENTS.md", "INJECTED_CONTEXT.md", "SOUL.md"]);
      const entries = fs.readdirSync(wsDir).filter(f => f.endsWith(".md") && !NATIVE_FILES.has(f)).sort();
      for (const entry of entries) {
        try {
          const content = fs.readFileSync(path.join(wsDir, entry), "utf-8");
          files.push({ name: entry.replace(/\.md$/, ""), content });
        } catch {}
      }
    } catch {}
    return files;
  }

  api.registerHttpRoute({
    path: "/web-tools/api/context",
    auth: "plugin",
    handler: async (req, res) => {
      if (req.method !== "GET") { res.statusCode = 405; res.end(); return; }
      const files = readWorkspaceFiles();
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify({ sections: files }));
    },
  });

  // --- Tasks / cron API ---

  function readCronJobs(): Record<string, unknown>[] {
    const cronDir = process.env.OPENCLAW_STATE_DIR || path.join(process.env.HOME || "", ".openclaw");
    const jobsPath = path.join(cronDir, "cron", "jobs.json");
    try {
      const data = JSON.parse(fs.readFileSync(jobsPath, "utf-8"));
      return Array.isArray(data.jobs) ? data.jobs : [];
    } catch {
      return [];
    }
  }

  api.registerHttpRoute({
    path: "/web-tools/api/tasks",
    auth: "plugin",
    handler: async (req, res) => {
      if (req.method !== "GET") { res.statusCode = 405; res.end(); return; }
      const jobs = readCronJobs();
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify({ jobs }));
    },
  });

  // --- Logs sharing status & toggle ---

  const stateDir = process.env.OPENCLAW_STATE_DIR || path.join(process.env.HOME || "", ".openclaw");
  const shareMarker = path.join(stateDir, ".share-trajectories");

  api.registerHttpRoute({
    path: "/web-tools/api/logs-status",
    auth: "plugin",
    handler: async (req, res) => {
      if (req.method !== "GET") { res.statusCode = 405; res.end(); return; }
      const enabled = fs.existsSync(shareMarker);
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify({ enabled }));
    },
  });

  api.registerHttpRoute({
    path: "/web-tools/api/logs-toggle",
    auth: "plugin",
    handler: async (req, res) => {
      if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
      let body = "";
      await new Promise<void>((resolve) => {
        req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        req.on("end", resolve);
      });
      const parsed = JSON.parse(body || "{}");
      const enable = !!parsed.enabled;
      try {
        if (enable) {
          fs.writeFileSync(shareMarker, "", "utf-8");
        } else {
          if (fs.existsSync(shareMarker)) fs.unlinkSync(shareMarker);
        }
      } catch {}
      const enabled = fs.existsSync(shareMarker);
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ enabled }));
    },
  });

  // --- Trajectories / logs ---

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
    // Format: each line is {type, ...}. Messages have type:"message" with
    // message:{role, content}. Content is string or [{type:"text",text:"..."}].
    for (const sess of sessions.slice(0, maxEntries)) {
      const jsonlPath = path.join(sessionsDir, `${sess.sessionId}.jsonl`);
      try {
        if (!fs.existsSync(jsonlPath)) continue;
        const lines = fs.readFileSync(jsonlPath, "utf-8").split("\n").filter(Boolean);
        const conversations: Record<string, unknown>[] = [];
        let model: string | undefined;
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.type === "model_change" && parsed.modelId) {
              model = parsed.modelId;
            }
            if (parsed.type !== "message") continue;
            const msg = parsed.message;
            if (!msg) continue;
            const role = msg.role || "unknown";
            let content = msg.content;
            // content can be string or array of content blocks:
            //   {type:"text", text:"..."} — text content
            //   {type:"toolCall", name:"...", arguments:{...}} — tool invocation
            if (Array.isArray(content)) {
              const parts: string[] = [];
              for (const block of content) {
                const b = block as Record<string, unknown>;
                if (b.type === "text") {
                  parts.push(b.text as string);
                } else if (b.type === "toolCall") {
                  // Wrap in <tool_call> tags so frontend parser handles them (same as Hermes)
                  parts.push("<tool_call>\n" + JSON.stringify({ name: b.name, arguments: b.arguments }) + "\n</tool_call>");
                }
              }
              content = parts.join("\n");
            }
            conversations.push({
              from: role,
              value: content || "",
              timestamp: parsed.timestamp || undefined,
            });
          } catch { /* skip bad lines */ }
        }
        if (conversations.length > 0) {
          entries.push({
            conversations,
            timestamp: sess.updatedAt ? new Date(sess.updatedAt).toISOString() : undefined,
            model,
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
    path: "/web-tools/logs",
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

      // Download raw JSONL as zip
      if (lastPart === "download") {
        if (!isSharingEnabled()) {
          res.statusCode = 403;
          res.end();
          return;
        }
        const sessionsDir = path.join(stateDir, "agents", "main", "sessions");
        const indexPath = path.join(sessionsDir, "sessions.json");
        try {
          const index = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
          // Collect JSONL files
          const files: { name: string; path: string }[] = [];
          for (const [, val] of Object.entries(index) as [string, Record<string, unknown>][]) {
            if (val?.sessionId) {
              const jsonlPath = path.join(sessionsDir, `${val.sessionId}.jsonl`);
              if (fs.existsSync(jsonlPath)) {
                files.push({ name: `${val.sessionId}.jsonl`, path: jsonlPath });
              }
            }
          }
          if (files.length === 0) {
            res.statusCode = 404;
            res.end("No JSONL files found");
            return;
          }
          // Create zip using child_process (execFileSync avoids shell injection)
          const { execFileSync } = require("node:child_process");
          const os = require("node:os");
          const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "traj-"));
          try {
            const zipPath = path.join(tmpDir, "trajectories.zip");
            execFileSync("zip", ["-j", zipPath, ...files.map(f => f.path)], { stdio: "ignore", timeout: 30_000 });
            const zipBuf = fs.readFileSync(zipPath);
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/zip");
            res.setHeader("Content-Disposition", "attachment; filename=trajectories.zip");
            res.setHeader("Cache-Control", "no-store");
            res.end(zipBuf);
          } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
          }
        } catch {
          res.statusCode = 500;
          res.end("Failed to create zip");
        }
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

      // Static assets
      if (lastPart === "logs.css") {
        serveFile(res, path.join(logsDir, "logs.css"), "text/css", "max-age=3600");
        return;
      }

      // Page — serve standalone logs page
      servePageWithToken(path.join(logsDir, "logs.html"), res);
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

      // All other skills paths — serve mini-app (JS will auto-select skills tab)
      servePageWithToken(path.join(sharedRoot, "index.html"), res);
    },
  });
}
