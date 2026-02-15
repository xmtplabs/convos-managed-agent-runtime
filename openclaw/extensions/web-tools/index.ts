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

function jsonResponse(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

export default function register(api: OpenClawPluginApi) {
  const formDir = path.resolve(__dirname, "form");
  const agentsDir = path.resolve(__dirname, "agents");
  const templatesPath = path.resolve(__dirname, "templates.json");

  api.registerHttpRoute({
    path: "/web-tools/templates",
    handler: async (req, res) => {
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.end();
        return;
      }
      try {
        const raw = fs.readFileSync(templatesPath, "utf-8");
        const data = JSON.parse(raw) as { templates: Array<{ slug: string; name: string; emoji?: string; description?: string }> };
        jsonResponse(res, 200, { templates: data.templates ?? [] });
      } catch {
        jsonResponse(res, 200, { templates: [] });
      }
    },
  });

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
      serveFile(
        res,
        path.join(agentsDir, "landing.html"),
        "text/html; charset=utf-8",
        "no-store",
      );
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
      serveFile(
        res,
        path.join(agentsDir, "landing.html"),
        "text/html; charset=utf-8",
        "no-store",
      );
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
