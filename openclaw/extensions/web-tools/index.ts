import type { ServerResponse } from "node:http";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

function resolveWorkspaceDir(api: OpenClawPluginApi): string {
  try {
    const cfg = api.runtime.config.loadConfig() as Record<string, unknown>;
    const agents = cfg?.agents as Record<string, unknown> | undefined;
    const defaults = agents?.defaults as Record<string, unknown> | undefined;
    const list = agents?.list as Array<Record<string, unknown>> | undefined;
    let raw =
      (defaults?.workspace as string) ??
      (Array.isArray(list) && list[0]?.workspace as string | undefined);
    if (raw) {
      if (raw.startsWith("~/")) {
        return path.join(os.homedir(), raw.slice(2));
      }
      return path.resolve(raw);
    }
  } catch {
    // fallback
  }
  return path.join(api.runtime.state.resolveStateDir(), "workspace");
}

function serveFile(res: ServerResponse, filePath: string, contentType: string) {
  try {
    const body = fs.readFileSync(filePath);
    res.statusCode = 200;
    res.setHeader("Content-Type", contentType);
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end();
  }
}

export default function register(api: OpenClawPluginApi) {
  const workspaceDir = resolveWorkspaceDir(api);
  const formPath = path.join(workspaceDir, "form", "form.html");

  api.registerHttpRoute({
    path: "/web-tools/form",
    handler: async (req, res) => {
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.end();
        return;
      }
      serveFile(res, formPath, "text/html; charset=utf-8");
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
      serveFile(res, formPath, "text/html; charset=utf-8");
    },
  });
}
