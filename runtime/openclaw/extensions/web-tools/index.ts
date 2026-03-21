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

export default function register(api: OpenClawPluginApi) {
  // Docker: /app/web-tools/. Local: apply-config.sh copies to STATE_DIR/web-tools/.
  const stateWebTools = path.join(process.env.OPENCLAW_STATE_DIR!, "web-tools");
  const sharedRoot = fs.existsSync("/app/web-tools") ? "/app/web-tools"
    : fs.existsSync(stateWebTools) ? stateWebTools
    : __dirname;
  const agentsDir = path.resolve(sharedRoot, "convos");
  const servicesDir = path.resolve(sharedRoot, "services");

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
}
