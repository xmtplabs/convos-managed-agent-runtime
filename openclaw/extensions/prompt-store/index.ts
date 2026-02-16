import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import * as fs from "node:fs";
import * as path from "node:path";
import * as http from "node:http";
import * as crypto from "node:crypto";

// --- Helpers ---

function serveFile(res: ServerResponse, filePath: string, contentType: string, cacheControl?: string) {
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

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString();
  if (!raw.trim()) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

function jsonResponse(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

// --- Template scanning ---

interface TemplateMeta {
  slug: string;
  name: string;
  emoji: string;
  description: string;
}

function listTemplates(): TemplateMeta[] {
  const templatesDir = path.resolve(__dirname, "templates");
  if (!fs.existsSync(templatesDir)) return [];

  const entries = fs.readdirSync(templatesDir, { withFileTypes: true });
  const templates: TemplateMeta[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metaPath = path.join(templatesDir, entry.name, "meta.json");
    if (!fs.existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      templates.push({
        slug: entry.name,
        name: meta.name ?? entry.name,
        emoji: meta.emoji ?? "",
        description: meta.description ?? "",
      });
    } catch {
      // Skip malformed meta.json
    }
  }

  return templates;
}

// --- Internal HTTP call to create a new identity and join a conversation ---

async function callCreateIdentityAndJoin(
  port: number,
  invite: string,
  accountId: string,
  name?: string,
): Promise<{ privateKey: string; conversationId: string; inboxId: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ invite, accountId, ...(name ? { name } : {}) });
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/convos/create-identity-and-join",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk as Buffer));
        res.on("end", () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString());
            if (res.statusCode !== 200 || body.error) {
              reject(new Error(body.error ?? `HTTP ${res.statusCode}`));
              return;
            }
            resolve({
              privateKey: body.privateKey,
              conversationId: body.conversationId,
              inboxId: body.inboxId,
            });
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

// --- Plugin registration ---

export default function register(api: OpenClawPluginApi) {
  const uiDir = path.resolve(__dirname, "ui");

  // GET /prompt-store — serve the factory UI
  api.registerHttpRoute({
    path: "/prompt-store",
    handler: async (req, res) => {
      if (req.method !== "GET") {
        jsonResponse(res, 405, { error: "Method Not Allowed" });
        return;
      }
      serveFile(res, path.join(uiDir, "factory.html"), "text/html; charset=utf-8", "no-store");
    },
  });

  api.registerHttpRoute({
    path: "/prompt-store/",
    handler: async (req, res) => {
      if (req.method !== "GET") {
        jsonResponse(res, 405, { error: "Method Not Allowed" });
        return;
      }
      serveFile(res, path.join(uiDir, "factory.html"), "text/html; charset=utf-8", "no-store");
    },
  });

  // GET /prompt-store/templates — list available templates
  api.registerHttpRoute({
    path: "/prompt-store/templates",
    handler: async (req, res) => {
      if (req.method !== "GET") {
        jsonResponse(res, 405, { error: "Method Not Allowed" });
        return;
      }
      jsonResponse(res, 200, { templates: listTemplates() });
    },
  });

  // POST /prompt-store/create — create a new agent from a template
  api.registerHttpRoute({
    path: "/prompt-store/create",
    handler: async (req, res) => {
      if (req.method !== "POST") {
        jsonResponse(res, 405, { error: "Method Not Allowed" });
        return;
      }

      try {
        const body = await readJsonBody(req);
        const templateSlug = typeof body.templateSlug === "string" ? body.templateSlug.trim() : "";
        const agentName = typeof body.name === "string" ? body.name.trim() : "";
        const inviteUrl = typeof body.inviteUrl === "string" ? body.inviteUrl.trim() : "";

        if (!templateSlug) {
          jsonResponse(res, 400, { error: "templateSlug is required." });
          return;
        }
        if (!inviteUrl) {
          jsonResponse(res, 400, { error: "inviteUrl is required." });
          return;
        }

        // 1. Validate template exists
        const templateDir = path.resolve(__dirname, "templates", templateSlug);
        if (!fs.existsSync(templateDir) || !fs.statSync(templateDir).isDirectory()) {
          jsonResponse(res, 400, { error: `Template "${templateSlug}" not found.` });
          return;
        }

        // 2. Generate agent ID
        const hexSuffix = crypto.randomBytes(2).toString("hex");
        const agentId = `${templateSlug}-${hexSuffix}`;

        // 3. Create new XMTP identity and join conversation via convos extension
        const gatewayPort = 18789;
        const { privateKey, conversationId, inboxId } = await callCreateIdentityAndJoin(
          gatewayPort,
          inviteUrl,
          agentId,
          agentName || undefined,
        );

        if (!conversationId) {
          jsonResponse(res, 400, { error: "Could not resolve conversation ID. Join may be pending approval." });
          return;
        }

        // 4. Save identity to state dir
        const stateDir = api.runtime.state.resolveStateDir();
        const identityDir = path.join(stateDir, "convos", agentId);
        fs.mkdirSync(identityDir, { recursive: true });
        const identityPayload: Record<string, string> = { privateKey };
        if (inboxId) identityPayload.inboxId = inboxId;
        fs.writeFileSync(
          path.join(identityDir, "identity.json"),
          JSON.stringify(identityPayload, null, 0),
          "utf8",
        );

        // 5. Copy template → workspace
        const workspacePath = path.join(stateDir, `workspace-${agentId}`);
        fs.cpSync(templateDir, workspacePath, { recursive: true });

        // 5b. If a name was provided, rewrite IDENTITY.md with the agent's name
        if (agentName) {
          const identityMdPath = path.join(workspacePath, "IDENTITY.md");
          const templateMeta = (() => {
            try {
              return JSON.parse(fs.readFileSync(path.join(templateDir, "meta.json"), "utf-8"));
            } catch { return {}; }
          })();
          const role = templateMeta.description || "AI assistant";
          const identityContent = [
            `# IDENTITY`,
            `Your name is **${agentName}**.`,
            `You are ${agentName}, a ${role} that lives inside a group chat.`,
            ``,
            `When someone addresses you by name ("${agentName}"), you MUST respond.`,
            `When a message is directed at everyone or is a general question, you may respond if it's relevant to your role.`,
            `When a message is clearly directed at another agent by name, do NOT respond.`,
            ``,
          ].join("\n");
          fs.writeFileSync(identityMdPath, identityContent, "utf-8");
        }

        // 6. Update config
        const cfg = api.runtime.config.loadConfig() as Record<string, unknown>;

        const agents = (cfg.agents ?? {}) as Record<string, unknown>;
        const agentsList = (Array.isArray(agents.list) ? agents.list : []) as unknown[];
        const agentEntry = { id: agentId, workspace: workspacePath };
        const updatedAgentsList = [...agentsList, agentEntry];

        const bindings = (Array.isArray(cfg.bindings) ? cfg.bindings : []) as unknown[];
        const binding = {
          agentId,
          match: {
            channel: "convos",
            accountId: agentId,
            peer: { kind: "group", id: conversationId },
          },
        };
        const updatedBindings = [...bindings, binding];

        const channels = (cfg.channels ?? {}) as Record<string, unknown>;
        const convos = (channels.convos ?? {}) as Record<string, unknown>;
        const existingAccounts = (
          convos.accounts && typeof convos.accounts === "object" ? convos.accounts : {}
        ) as Record<string, unknown>;

        const updatedCfg = {
          ...cfg,
          agents: {
            ...agents,
            list: updatedAgentsList,
          },
          bindings: updatedBindings,
          channels: {
            ...channels,
            convos: {
              ...convos,
              accounts: {
                ...existingAccounts,
                [agentId]: {
                  enabled: true,
                  ...(agentName ? { name: agentName } : {}),
                  groups: [conversationId],
                },
              },
            },
          },
        };

        await api.runtime.config.writeConfigFile(updatedCfg);

        // 7. Collect all agents in this conversation (from updated config)
        const allAccounts = (updatedCfg.channels as Record<string, unknown>).convos as Record<string, unknown>;
        const accountsMap = (
          allAccounts.accounts && typeof allAccounts.accounts === "object" ? allAccounts.accounts : {}
        ) as Record<string, Record<string, unknown>>;
        const members: Array<{ agentId: string; name?: string }> = [];
        for (const [id, acct] of Object.entries(accountsMap)) {
          const groups = Array.isArray(acct.groups) ? (acct.groups as string[]) : [];
          if (groups.includes(conversationId)) {
            members.push({ agentId: id, ...(typeof acct.name === "string" ? { name: acct.name } : {}) });
          }
        }

        // 8. Return result (gateway auto-reloads via channels.convos config prefix)
        jsonResponse(res, 200, {
          agentId,
          conversationId,
          ...(agentName ? { name: agentName } : {}),
          members,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        jsonResponse(res, 500, { error: msg });
      }
    },
  });
}
