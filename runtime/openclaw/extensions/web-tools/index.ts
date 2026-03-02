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
async function getServicesData(): Promise<Record<string, unknown>> {
  const email = process.env.AGENTMAIL_INBOX_ID || null;
  const phone = process.env.TELNYX_PHONE_NUMBER || null;
  const domain = process.env.RAILWAY_PUBLIC_DOMAIN;
  const port = process.env.POOL_SERVER_PORT || process.env.PORT || "18789";
  const servicesUrl = domain
    ? `https://${domain}/web-tools/services`
    : `http://127.0.0.1:${port}/web-tools/services`;

  const result: Record<string, unknown> = { email, phone, servicesUrl };

  // Try to fetch credits from pool manager
  const instanceId = process.env.INSTANCE_ID;
  const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;
  const poolUrl = process.env.POOL_URL;

  if (instanceId && gatewayToken && poolUrl) {
    try {
      const creditsRes = await fetch(`${poolUrl}/api/pool/credits-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instanceId, gatewayToken }),
        signal: AbortSignal.timeout(5_000),
      });
      if (creditsRes.ok) {
        result.credits = await creditsRes.json();
      } else {
        result.credits = { error: "unavailable" };
      }
    } catch {
      result.credits = { error: "unavailable" };
    }
  } else {
    result.credits = { error: "not pool-managed" };
  }

  return result;
}

export default function register(api: OpenClawPluginApi) {
  const formDir = path.resolve(__dirname, "form");
  const agentsDir = path.resolve(__dirname, "convos");
  const servicesDir = path.resolve(__dirname, "services");

  api.registerHttpRoute({
    path: "/web-tools/form",
    handler: async (req, res) => {
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.end();
        return;
      }
      serveFile(res, path.join(formDir, "form.html"), "text/html; charset=utf-8");
    },
  });

  api.registerHttpRoute({
    path: "/web-tools/form/",
    handler: async (req, res) => {
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.end();
        return;
      }
      serveFile(res, path.join(formDir, "form.html"), "text/html; charset=utf-8");
    },
  });

  api.registerHttpRoute({
    path: "/web-tools/convos",
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
}
