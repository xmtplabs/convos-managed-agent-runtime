import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { resolveConvosAccount, type CoreConfig } from "./src/accounts.js";
import { convosPlugin, startWiredInstance } from "./src/channel.js";
import { getConvosInstance, setConvosInstance } from "./src/outbound.js";
import { getConvosRuntime, setConvosRuntime } from "./src/runtime.js";
import { ConvosInstance } from "./src/sdk-client.js";
import { clearConvosCredentials, loadConvosCredentials, saveConvosCredentials } from "./src/credentials.js";
import { stats } from "./src/stats.js";

const CUSTOM_INSTRUCTIONS_MARKER = "## Custom Instructions";

function convosStateDir(): string {
  return process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw");
}

function convosWorkspaceDir(): string {
  return path.join(convosStateDir(), "workspace");
}

function convosIdentityPath(): string {
  return path.join(convosWorkspaceDir(), "IDENTITY.md");
}

function convosHomeDir(): string {
  return path.join(os.homedir(), ".convos");
}

function pathHasState(target: string): boolean {
  try {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      return fs.readdirSync(target).length > 0;
    }
    return stat.size > 0;
  } catch {
    return false;
  }
}

function hasCustomInstructions(): boolean {
  try {
    return fs.readFileSync(convosIdentityPath(), "utf-8").includes(CUSTOM_INSTRUCTIONS_MARKER);
  } catch {
    return false;
  }
}

function clearCustomInstructions(): boolean {
  const identityPath = convosIdentityPath();
  let currentIdentity = "";
  try { currentIdentity = fs.readFileSync(identityPath, "utf-8"); } catch { return false; }
  const markerIdx = currentIdentity.indexOf(CUSTOM_INSTRUCTIONS_MARKER);
  if (markerIdx === -1) return false;
  const base = currentIdentity.slice(0, markerIdx).replace(/\n---\s*\n*$/, "").trimEnd();
  if (base) {
    fs.writeFileSync(identityPath, `${base}\n`);
  } else {
    fs.rmSync(identityPath, { force: true });
  }
  console.log(`[convos] Cleared custom instructions from ${identityPath}`);
  return true;
}

function isClean(): boolean {
  if (getConvosInstance()) return false;
  if (loadConvosCredentials()) return false;
  if (hasCustomInstructions()) return false;
  if (pathHasState(path.join(convosHomeDir(), "identities"))) return false;
  if (pathHasState(path.join(convosHomeDir(), "db"))) return false;
  if (process.env.CONVOS_CONVERSATION_ID?.trim()) return false;
  try {
    const runtime = getConvosRuntime();
    const cfg = runtime.config.loadConfig() as Record<string, unknown>;
    const channels = (cfg.channels ?? {}) as Record<string, unknown>;
    const convos = (channels.convos ?? {}) as Record<string, unknown>;
    if ((typeof convos.identityId === "string" && convos.identityId.trim())
      || (typeof convos.ownerConversationId === "string" && convos.ownerConversationId.trim())) {
      return false;
    }
  } catch {}
  return true;
}

function buildRuntimeStatus() {
  const inst = getConvosInstance();
  return {
    conversationId: inst?.conversationId ?? null,
    pending: false,
    clean: isClean(),
  };
}

async function factoryReset() {
  console.log("[convos] Factory reset started");
  await stats.shutdown();
  // Stop active instance
  const inst = getConvosInstance();
  if (inst) {
    try { await inst.stop(); } catch { /* best-effort */ }
    setConvosInstance(null);
  }

  // Clear config binding
  try {
    const runtime = getConvosRuntime();
    const cfg = runtime.config.loadConfig() as Record<string, unknown>;
    const channels = (cfg.channels ?? {}) as Record<string, unknown>;
    const convos = { ...(channels.convos ?? {}) as Record<string, unknown> };
    delete convos.identityId;
    delete convos.ownerConversationId;
    await runtime.config.writeConfigFile({ ...cfg, channels: { ...channels, convos } });
  } catch {}

  clearConvosCredentials();
  clearCustomInstructions();
  delete process.env.CONVOS_CONVERSATION_ID;

  // Clear CLI identity + db
  for (const entry of ["identities", "db"]) {
    const target = path.join(convosHomeDir(), entry);
    try { fs.rmSync(target, { recursive: true, force: true }); } catch {}
  }

  const status = buildRuntimeStatus();
  console.log(`[convos] Factory reset complete (clean=${status.clean})`);
  return { ok: true, reset: true, status };
}

/** Write custom instructions into workspace IDENTITY.md so the agent sees them on every message. */
function writeInstructions(rawInstructions: unknown) {
  const instructions =
    typeof rawInstructions === "string" && rawInstructions.trim()
      ? rawInstructions
      : null;
  if (!instructions) return; // No custom instructions — AGENTS.md covers defaults
  const wsDir = convosWorkspaceDir();
  fs.mkdirSync(wsDir, { recursive: true });
  const identityPath = convosIdentityPath();
  let baseIdentity = "";
  try { baseIdentity = fs.readFileSync(identityPath, "utf-8"); } catch { /* first run — no base file yet */ }
  const markerIdx = baseIdentity.indexOf(CUSTOM_INSTRUCTIONS_MARKER);
  const base = markerIdx !== -1 ? baseIdentity.slice(0, markerIdx).replace(/\n---\s*\n*$/, "") : baseIdentity;
  const identityContent = base.trim()
    ? `${base.trim()}\n\n---\n\n${CUSTOM_INSTRUCTIONS_MARKER}\n\n${instructions}`
    : `${CUSTOM_INSTRUCTIONS_MARKER}\n\n${instructions}`;
  fs.writeFileSync(identityPath, identityContent);
  console.log(`[convos] wrote IDENTITY.md (${identityContent.length} chars) to ${identityPath}`);
}

// --- HTTP helpers ---

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let totalSize = 0;
  for await (const chunk of req) {
    totalSize += (chunk as Buffer).length;
    if (totalSize > MAX_BODY_BYTES) {
      throw new Error("Request body too large");
    }
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString();
  if (!raw.trim()) {
    return {};
  }
  return JSON.parse(raw) as Record<string, unknown>;
}

function jsonResponse(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function checkPoolAuth(req: IncomingMessage): boolean {
  const token = process.env.OPENCLAW_GATEWAY_TOKEN;
  if (!token) return true; // No gateway token configured — allow all
  const authHeader = req.headers.authorization;
  return authHeader === `Bearer ${token}`;
}

// --- Plugin ---

const plugin = {
  id: "convos",
  name: "Convos",
  description: "E2E encrypted messaging via XMTP",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setConvosRuntime(api.runtime);
    api.registerChannel({ plugin: convosPlugin });

    // ---- WebSocket gateway methods (for Control UI) ----

    api.registerGatewayMethod("convos.reset", async ({ respond }) => {
      try {
        const result = await factoryReset();
        respond(true, result, undefined);
      } catch (err) {
        respond(false, undefined, {
          code: -1,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });

    // ---- HTTP routes (for Railway template and other HTTP clients) ----

    // Create a new conversation via CLI. Used by pool manager for provisioning.
    api.registerHttpRoute({
      path: "/convos/conversation",
      auth: "plugin",
      handler: async (req, res) => {
        if (req.method !== "POST") {
          jsonResponse(res, 405, { error: "Method Not Allowed" });
          return;
        }
        if (!checkPoolAuth(req)) {
          jsonResponse(res, 401, { error: "Unauthorized" });
          return;
        }
        try {
          // Guard: reject if instance already bound
          if (getConvosInstance()) {
            jsonResponse(res, 409, {
              error:
                "Instance already bound to a conversation. Terminate process and provision a new one.",
            });
            return;
          }


          const body = await readJsonBody(req);
          const name = typeof body.name === "string" ? body.name : "Convos Agent";
          const profileName = typeof body.profileName === "string" ? body.profileName : name;
          const profileImage =
            typeof body.profileImage === "string" ? body.profileImage : undefined;
          const description = typeof body.description === "string" ? body.description : undefined;
          const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl : undefined;
          const permissions =
            body.permissions === "all-members" || body.permissions === "admin-only"
              ? body.permissions
              : undefined;
          const accountId = typeof body.accountId === "string" ? body.accountId : undefined;

          writeInstructions(body.instructions);

          const runtime = getConvosRuntime();
          const cfg = runtime.config.loadConfig();
          const account = resolveConvosAccount({ cfg: cfg as CoreConfig, accountId });
          const env = body.env === "dev" || body.env === "production" ? body.env : account.env;

          const { instance, result } = await ConvosInstance.create(env, {
            name,
            profileName,
            description,
            imageUrl,
            permissions,
          });

          // Save to config so startAccount can restore on restart
          const existingChannels = (cfg as Record<string, unknown>).channels as
            | Record<string, unknown>
            | undefined;
          const existingConvos = (existingChannels?.convos ?? {}) as Record<string, unknown>;
          await runtime.config.writeConfigFile({
            ...cfg,
            channels: {
              ...existingChannels,
              convos: {
                ...existingConvos,
                env,
                enabled: true,
              },
            },
          });
          saveConvosCredentials({
            identityId: instance.identityId,
            ownerConversationId: result.conversationId,
          });

          // Start with full message handling pipeline (must happen before
          // updateProfile so the join-approval stream handler is active)
          await startWiredInstance({
            conversationId: result.conversationId,
            identityId: instance.identityId,
            env,
          });

          jsonResponse(res, 200, {
            conversationId: result.conversationId,
            inviteUrl: result.inviteUrl,
            inviteSlug: result.inviteSlug,
          });
        } catch (err) {
          jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      },
    });

    // Join an existing conversation via invite URL.
    // Used by pool manager to join a user-created conversation.
    api.registerHttpRoute({
      path: "/convos/join",
      auth: "plugin",
      handler: async (req, res) => {
        if (req.method !== "POST") {
          jsonResponse(res, 405, { error: "Method Not Allowed" });
          return;
        }
        if (!checkPoolAuth(req)) {
          jsonResponse(res, 401, { error: "Unauthorized" });
          return;
        }
        try {
          // Guard: reject if instance already bound
          if (getConvosInstance()) {
            jsonResponse(res, 409, {
              error:
                "Instance already bound to a conversation. Terminate process and provision a new one.",
            });
            return;
          }


          const body = await readJsonBody(req);
          const inviteUrl = typeof body.inviteUrl === "string" ? body.inviteUrl : undefined;
          if (!inviteUrl) {
            jsonResponse(res, 400, { error: "inviteUrl (string) is required" });
            return;
          }
          const profileName =
            typeof body.profileName === "string" ? body.profileName : "Convos Agent";
          const profileImage =
            typeof body.profileImage === "string" ? body.profileImage : undefined;
          const accountId = typeof body.accountId === "string" ? body.accountId : undefined;

          writeInstructions(body.instructions);

          const runtime = getConvosRuntime();
          const cfg = runtime.config.loadConfig();
          const account = resolveConvosAccount({ cfg: cfg as CoreConfig, accountId });
          const env = body.env === "dev" || body.env === "production" ? body.env : account.env;

          const metadata = typeof body.metadata === "object" && body.metadata !== null && !Array.isArray(body.metadata)
            ? body.metadata as Record<string, string>
            : undefined;

          const { instance, status, conversationId } = await ConvosInstance.join(env, inviteUrl, {
            profileName,
            profileImage,
            metadata,
            timeout: 60,
          });

          if (status !== "joined" || !conversationId || !instance) {
            jsonResponse(res, 200, { status: "pending_acceptance" });
            return;
          }

          // Save to config
          const existingChannels = (cfg as Record<string, unknown>).channels as
            | Record<string, unknown>
            | undefined;
          const existingConvos = (existingChannels?.convos ?? {}) as Record<string, unknown>;
          await runtime.config.writeConfigFile({
            ...cfg,
            channels: {
              ...existingChannels,
              convos: {
                ...existingConvos,
                env,
                enabled: true,
              },
            },
          });
          saveConvosCredentials({
            identityId: instance.identityId,
            ownerConversationId: conversationId,
          });

          // Start with full message handling pipeline
          await startWiredInstance({
            conversationId,
            identityId: instance.identityId,
            env,
          });

          jsonResponse(res, 200, { status: "joined", conversationId });
        } catch (err) {
          jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      },
    });

    // Send a message into the active conversation.
    api.registerHttpRoute({
      path: "/convos/conversation/send",
      auth: "plugin",
      handler: async (req, res) => {
        if (req.method !== "POST") {
          jsonResponse(res, 405, { error: "Method Not Allowed" });
          return;
        }
        if (!checkPoolAuth(req)) {
          jsonResponse(res, 401, { error: "Unauthorized" });
          return;
        }
        try {
          const inst = getConvosInstance();
          if (!inst) {
            jsonResponse(res, 400, { error: "No active conversation" });
            return;
          }

          const body = await readJsonBody(req);
          const message = typeof body.message === "string" ? body.message : undefined;
          if (!message) {
            jsonResponse(res, 400, { error: "message (string) is required" });
            return;
          }

          const result = await inst.sendMessage(message);
          jsonResponse(res, 200, result);
        } catch (err) {
          jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      },
    });

    // Rename conversation + agent profile name.
    api.registerHttpRoute({
      path: "/convos/rename",
      auth: "plugin",
      handler: async (req, res) => {
        if (req.method !== "POST") {
          jsonResponse(res, 405, { error: "Method Not Allowed" });
          return;
        }
        if (!checkPoolAuth(req)) {
          jsonResponse(res, 401, { error: "Unauthorized" });
          return;
        }
        try {
          const inst = getConvosInstance();
          if (!inst) {
            jsonResponse(res, 400, { error: "No active conversation" });
            return;
          }

          const body = await readJsonBody(req);
          const name = typeof body.name === "string" ? body.name : undefined;
          if (!name) {
            jsonResponse(res, 400, { error: "name (string) is required" });
            return;
          }

          await inst.rename(name);
          jsonResponse(res, 200, { ok: true });
        } catch (err) {
          jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      },
    });

    // Lock/unlock the conversation.
    api.registerHttpRoute({
      path: "/convos/lock",
      auth: "plugin",
      handler: async (req, res) => {
        if (req.method !== "POST") {
          jsonResponse(res, 405, { error: "Method Not Allowed" });
          return;
        }
        if (!checkPoolAuth(req)) {
          jsonResponse(res, 401, { error: "Unauthorized" });
          return;
        }
        try {
          const inst = getConvosInstance();
          if (!inst) {
            jsonResponse(res, 400, { error: "No active conversation" });
            return;
          }

          const body = await readJsonBody(req);
          const unlock = body.unlock === true;
          if (unlock) {
            await inst.unlock();
          } else {
            await inst.lock();
          }
          jsonResponse(res, 200, { ok: true, locked: !unlock });
        } catch (err) {
          jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      },
    });

    // Explode (destroy) the conversation.
    api.registerHttpRoute({
      path: "/convos/explode",
      auth: "plugin",
      handler: async (req, res) => {
        if (req.method !== "POST") {
          jsonResponse(res, 405, { error: "Method Not Allowed" });
          return;
        }
        if (!checkPoolAuth(req)) {
          jsonResponse(res, 401, { error: "Unauthorized" });
          return;
        }
        try {
          const inst = getConvosInstance();
          if (!inst) {
            jsonResponse(res, 400, { error: "No active conversation" });
            return;
          }

          await inst.explode();
          setConvosInstance(null);
          jsonResponse(res, 200, { ok: true, exploded: true });
        } catch (err) {
          jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      },
    });

    // Health/status: full runtime status for pool manager decision-making.
    api.registerHttpRoute({
      path: "/convos/status",
      auth: "plugin",
      handler: async (req, res) => {
        if (req.method !== "GET") {
          jsonResponse(res, 405, { error: "Method Not Allowed" });
          return;
        }
        if (!checkPoolAuth(req)) {
          jsonResponse(res, 401, { error: "Unauthorized" });
          return;
        }
        jsonResponse(res, 200, buildRuntimeStatus());
      },
    });

    // Factory reset: stop running instance, clear all state, return clean status.
    api.registerHttpRoute({
      path: "/convos/reset",
      auth: "plugin",
      handler: async (req, res) => {
        if (req.method !== "POST") {
          jsonResponse(res, 405, { error: "Method Not Allowed" });
          return;
        }
        if (!checkPoolAuth(req)) {
          jsonResponse(res, 401, { error: "Unauthorized" });
          return;
        }
        try {
          const result = await factoryReset();
          jsonResponse(res, 200, result);
        } catch (err) {
          jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      },
    });
  },
};

export default plugin;
