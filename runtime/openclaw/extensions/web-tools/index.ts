import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import * as fs from "node:fs";
import * as path from "node:path";

const DOMAIN_FILE = "/tmp/service-domain";
let cachedHost: string | null = null;

/** Persist the public host discovered from an incoming request. */
function detectHost(req: IncomingMessage): void {
  if (cachedHost) return;
  const host = req.headers.host;
  if (!host || host.startsWith("127.0.0.1") || host.startsWith("localhost")) return;
  cachedHost = host;
  try { fs.writeFileSync(DOMAIN_FILE, host); } catch { /* best-effort */ }
}

/** Read a previously-detected host from the temp file (for non-HTTP contexts). */
function readCachedHost(): string | null {
  if (cachedHost) return cachedHost;
  try {
    const h = fs.readFileSync(DOMAIN_FILE, "utf-8").trim();
    if (h) { cachedHost = h; return h; }
  } catch { /* not yet detected */ }
  return null;
}

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

/** Read poolApiKey from runtime config so the landing page can auth to convos endpoints. */
function getPoolApiKey(api: OpenClawPluginApi): string {
  try {
    const cfg = api.runtime.config.loadConfig() as Record<string, unknown>;
    const channels = cfg.channels as Record<string, unknown> | undefined;
    const convos = channels?.convos as Record<string, unknown> | undefined;
    return (convos?.poolApiKey as string) || "";
  } catch {
    return "";
  }
}

/** Serve an HTML page with the poolApiKey injected as a JS variable. */
function servePageWithToken(api: OpenClawPluginApi, htmlPath: string, res: ServerResponse) {
  try {
    let html = fs.readFileSync(htmlPath, "utf-8");
    const token = getPoolApiKey(api);
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

/** Serve the landing page with the poolApiKey injected as a JS variable. */
function serveLandingPage(api: OpenClawPluginApi, agentsDir: string, res: ServerResponse) {
  servePageWithToken(api, path.join(agentsDir, "landing.html"), res);
}

/** Build service identity + credits data from env vars and pool manager. */
async function getServicesData(req?: IncomingMessage): Promise<Record<string, unknown>> {
  const email = process.env.AGENTMAIL_INBOX_ID || null;
  const phone = process.env.TELNYX_PHONE_NUMBER || null;
  const servicesUrl = buildServicesUrl(req);

  const instanceId = process.env.INSTANCE_ID || null;
  const result: Record<string, unknown> = { email, phone, servicesUrl, instanceId };

  // Try to fetch credits from pool manager
  const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;
  const poolUrl = process.env.POOL_URL;

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

function buildServicesUrl(req?: IncomingMessage): string {
  // 1. Incoming request Host header (most reliable — matches what the user typed)
  const reqHost = req?.headers.host;
  if (reqHost && !reqHost.startsWith("127.0.0.1") && !reqHost.startsWith("localhost")) {
    const proto = reqHost.includes("localhost") ? "http" : "https";
    return `${proto}://${reqHost}/web-tools/services`;
  }
  // 2. Previously detected host from an earlier HTTP request
  const cached = readCachedHost();
  if (cached) return `https://${cached}/web-tools/services`;
  // 3. Railway / ngrok env vars
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

export default function register(api: OpenClawPluginApi) {
  const agentsDir = path.resolve(__dirname, "convos");
  const servicesDir = path.resolve(__dirname, "services");

  // Intercept outgoing messages that contain raw provider credit errors
  // and replace with a friendly services URL. Works across all channels.
  api.on("message_sending", (event) => {
    const text = event.content || "";
    if (
      text.includes("limit exceeded") ||
      text.includes("402") ||
      text.includes("afford") ||
      text.includes("openrouter.ai/settings")
    ) {
      const servicesUrl = buildServicesUrl();
      return {
        content: `Hey! I'm out of credits. You can top up here: ${servicesUrl}`,
      };
    }
  });

  api.registerHttpRoute({
    path: "/web-tools/convos",
    handler: async (req, res) => {
      detectHost(req);
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.end();
        return;
      }
      serveLandingPage(api, agentsDir, res);
    },
  });

  api.registerHttpRoute({
    path: "/web-tools/convos/",
    handler: async (req, res) => {
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.end();
        return;
      }
      serveLandingPage(api, agentsDir, res);
    },
  });

  api.registerHttpRoute({
    path: "/web-tools/convos/manifest.json",
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
    path: "/web-tools/convos/icon.svg",
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
    handler: async (req, res) => {
      detectHost(req);
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.end();
        return;
      }
      servePageWithToken(api, path.join(servicesDir, "services.html"), res);
    },
  });

  api.registerHttpRoute({
    path: "/web-tools/services/",
    handler: async (req, res) => {
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.end();
        return;
      }
      servePageWithToken(api, path.join(servicesDir, "services.html"), res);
    },
  });

  api.registerHttpRoute({
    path: "/web-tools/services/api",
    handler: async (req, res) => {
      detectHost(req);
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.end();
        return;
      }
      try {
        const data = await getServicesData(req);
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
    path: "/web-tools/services/topup",
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
}
