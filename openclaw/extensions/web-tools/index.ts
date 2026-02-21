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

/** Read pool config from runtime config. */
function getPoolConfig(api: OpenClawPluginApi): { token: string; url: string } {
  try {
    const cfg = api.runtime.config.loadConfig() as Record<string, unknown>;
    const channels = cfg.channels as Record<string, unknown> | undefined;
    const convos = channels?.convos as Record<string, unknown> | undefined;
    return {
      token: (convos?.poolApiKey as string) || "",
      url: (convos?.poolUrl as string) || "",
    };
  } catch {
    return { token: "", url: "" };
  }
}

/** Serve the landing page with the poolApiKey injected as a JS variable. */
function serveLandingPage(api: OpenClawPluginApi, agentsDir: string, res: ServerResponse) {
  try {
    let html = fs.readFileSync(path.join(agentsDir, "landing.html"), "utf-8");
    const { token } = getPoolConfig(api);
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

export default function register(api: OpenClawPluginApi) {
  const formDir = path.resolve(__dirname, "form");
  const agentsDir = path.resolve(__dirname, "agents");

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
    path: "/web-tools/agents",
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
    path: "/web-tools/agents/",
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
    path: "/web-tools/agents/manifest.json",
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
    path: "/web-tools/agents/sw.js",
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
    path: "/web-tools/agents/icon.svg",
    handler: async (req, res) => {
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.end();
        return;
      }
      serveFile(res, path.join(agentsDir, "icon.svg"), "image/svg+xml");
    },
  });

}
