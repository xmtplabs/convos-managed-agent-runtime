import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { resolveConvosAccount, type CoreConfig } from "./src/accounts.js";
import {
  clearConvosMediaState,
  clearConvosSessionState,
  convosPlugin,
  clearPendingCompanionState,
  hasConvosMediaState,
  hasPendingCompanionState,
  hasConvosSessionState,
  startWiredInstance,
} from "./src/channel.js";
import { getConvosInstance, setConvosInstance } from "./src/outbound.js";
import { getConvosRuntime, setConvosRuntime } from "./src/runtime.js";
import { ConvosInstance } from "./src/sdk-client.js";
import {
  clearConvosCredentials,
  loadConvosCredentials,
  saveConvosCredentials,
} from "./src/credentials.js";

const CUSTOM_INSTRUCTIONS_MARKER = "## Custom Instructions";
const JOIN_RESPONSE_WAIT_MS = 55_000;
const PENDING_JOIN_TIMEOUT_SECONDS = 24 * 60 * 60;

type ProvisionState = "idle" | "creating" | "joining" | "pending_acceptance" | "active" | "failed";

type PersistedPendingJoin = {
  state: "pending_acceptance" | "failed";
  startedAt: string;
  inviteUrl: string;
  watching: boolean;
  lastError: string | null;
};

type RuntimeProvision = {
  state: ProvisionState;
  startedAt: string | null;
  inviteUrl: string | null;
  watching: boolean;
  lastError: string | null;
};

let provisionState: RuntimeProvision | null = null;
let provisionGeneration = 0;
let pendingJoinAbortController: AbortController | null = null;
let pendingJoinPromise: Promise<void> | null = null;

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

function pendingJoinStatePath(): string {
  return path.join(convosStateDir(), "pending-join.json");
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

function readPersistedPendingJoin(): PersistedPendingJoin | null {
  try {
    const raw = JSON.parse(fs.readFileSync(pendingJoinStatePath(), "utf-8")) as PersistedPendingJoin;
    if ((raw.state === "pending_acceptance" || raw.state === "failed")
      && typeof raw.startedAt === "string"
      && typeof raw.inviteUrl === "string"
      && typeof raw.watching === "boolean") {
      return {
        state: raw.state,
        startedAt: raw.startedAt,
        inviteUrl: raw.inviteUrl,
        watching: raw.watching,
        lastError: typeof raw.lastError === "string" ? raw.lastError : null,
      };
    }
  } catch {
    // ignore
  }
  return null;
}

function writePersistedPendingJoin(record: PersistedPendingJoin | null): void {
  const target = pendingJoinStatePath();
  if (!record) {
    fs.rmSync(target, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(record, null, 2) + "\n");
}

function setProvisionState(
  state: ProvisionState,
  params?: { startedAt?: string; inviteUrl?: string | null; watching?: boolean; lastError?: string | null },
): number {
  provisionGeneration += 1;
  provisionState = {
    state,
    startedAt: params?.startedAt ?? new Date().toISOString(),
    inviteUrl: params?.inviteUrl ?? null,
    watching: params?.watching ?? false,
    lastError: params?.lastError ?? null,
  };
  if (state === "pending_acceptance" || state === "failed") {
    writePersistedPendingJoin({
      state: state === "failed" ? "failed" : "pending_acceptance",
      startedAt: provisionState.startedAt ?? new Date().toISOString(),
      inviteUrl: provisionState.inviteUrl ?? "",
      watching: provisionState.watching,
      lastError: provisionState.lastError,
    });
  } else {
    writePersistedPendingJoin(null);
  }
  return provisionGeneration;
}

function updateProvisionState(
  generation: number,
  patch: Partial<Omit<RuntimeProvision, "startedAt">> & { startedAt?: string | null },
): void {
  if (generation !== provisionGeneration || !provisionState) {
    return;
  }
  provisionState = { ...provisionState, ...patch };
  if (provisionState.state === "pending_acceptance" || provisionState.state === "failed") {
    writePersistedPendingJoin({
      state: provisionState.state === "failed" ? "failed" : "pending_acceptance",
      startedAt: provisionState.startedAt ?? new Date().toISOString(),
      inviteUrl: provisionState.inviteUrl ?? "",
      watching: provisionState.watching,
      lastError: provisionState.lastError,
    });
  } else {
    writePersistedPendingJoin(null);
  }
}

function clearProvisionState(generation?: number): void {
  if (generation !== undefined && generation !== provisionGeneration) {
    return;
  }
  provisionGeneration += 1;
  provisionState = null;
  pendingJoinAbortController = null;
  pendingJoinPromise = null;
  writePersistedPendingJoin(null);
}

function getProvisionStatus(): RuntimeProvision {
  const inst = getConvosInstance();
  if (inst) {
    return {
      state: "active",
      startedAt: null,
      inviteUrl: null,
      watching: false,
      lastError: null,
    };
  }
  if (provisionState) {
    return provisionState;
  }
  const persisted = readPersistedPendingJoin();
  if (!persisted) {
    return {
      state: "idle",
      startedAt: null,
      inviteUrl: null,
      watching: false,
      lastError: null,
    };
  }
  return {
    state: "failed",
    startedAt: persisted.startedAt,
    inviteUrl: persisted.inviteUrl,
    watching: false,
    lastError: persisted.lastError ?? "Pending join did not survive process restart",
  };
}

function resolveSessionProbeConversationId(
  convos: Record<string, unknown>,
  activeConversationId: string | null,
): string {
  if (activeConversationId) {
    return activeConversationId;
  }
  if (typeof convos.ownerConversationId === "string" && convos.ownerConversationId.trim()) {
    return convos.ownerConversationId;
  }
  if (typeof process.env.CONVOS_CONVERSATION_ID === "string" && process.env.CONVOS_CONVERSATION_ID.trim()) {
    return process.env.CONVOS_CONVERSATION_ID;
  }
  return "status-probe";
}

function buildRuntimeStatus() {
  const runtime = getConvosRuntime();
  const cfg = runtime.config.loadConfig() as Record<string, unknown>;
  const channels = (cfg.channels ?? {}) as Record<string, unknown>;
  const convos = (channels.convos ?? {}) as Record<string, unknown>;
  const inst = getConvosInstance();
  const conversationId = inst?.conversationId ?? null;
  const streaming = inst?.isStreaming() ?? false;
  const provision = getProvisionStatus();
  const sessionProbeConversationId = resolveSessionProbeConversationId(convos, conversationId);

  const persisted = {
    credentialsPresent: loadConvosCredentials() !== null,
    configBindingPresent:
      (typeof convos.identityId === "string" && convos.identityId.trim().length > 0)
      || (typeof convos.ownerConversationId === "string" && convos.ownerConversationId.trim().length > 0),
    customInstructionsPresent: hasCustomInstructions(),
    cliIdentityPresent: pathHasState(path.join(convosHomeDir(), "identities")),
    cliDbPresent: pathHasState(path.join(convosHomeDir(), "db")),
    sessionStatePresent: hasConvosSessionState(sessionProbeConversationId),
    mediaCachePresent: hasConvosMediaState(),
    conversationEnvPresent:
      typeof process.env.CONVOS_CONVERSATION_ID === "string"
      && process.env.CONVOS_CONVERSATION_ID.trim().length > 0,
  };
  const transient = {
    pendingCompanionStatePresent: hasPendingCompanionState(),
  };

  const dirtyReasons: string[] = [];
  if (conversationId) dirtyReasons.push("active_conversation");
  if (persisted.credentialsPresent) dirtyReasons.push("saved_credentials");
  if (persisted.configBindingPresent) dirtyReasons.push("config_binding");
  if (persisted.customInstructionsPresent) dirtyReasons.push("custom_instructions");
  if (persisted.cliIdentityPresent) dirtyReasons.push("cli_identity");
  if (persisted.cliDbPresent) dirtyReasons.push("cli_db");
  if (persisted.sessionStatePresent) dirtyReasons.push("session_state");
  if (persisted.mediaCachePresent) dirtyReasons.push("media_cache");
  if (persisted.conversationEnvPresent) dirtyReasons.push("conversation_env");
  if (transient.pendingCompanionStatePresent) dirtyReasons.push("pending_companion_state");
  if (provision.state !== "idle") dirtyReasons.push(`provision_${provision.state}`);

  const clean = dirtyReasons.length === 0;

  return {
    ready: true,
    conversation: conversationId ? { id: conversationId } : null,
    streaming,
    main: {
      active: Boolean(conversationId),
      conversationId,
      streaming,
    },
    provision,
    persisted,
    transient,
    dirtyReasons,
    clean,
  };
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
  // Replace existing Custom Instructions block instead of accumulating duplicates
  const markerIdx = baseIdentity.indexOf(CUSTOM_INSTRUCTIONS_MARKER);
  const base = markerIdx !== -1 ? baseIdentity.slice(0, markerIdx).replace(/\n---\s*\n*$/, "") : baseIdentity;
  const identityContent = base.trim()
    ? `${base.trim()}\n\n---\n\n${CUSTOM_INSTRUCTIONS_MARKER}\n\n${instructions}`
    : `${CUSTOM_INSTRUCTIONS_MARKER}\n\n${instructions}`;
  fs.writeFileSync(identityPath, identityContent);
  console.log(`[convos] wrote IDENTITY.md (${identityContent.length} chars) to ${identityPath}`);
}

function clearCustomInstructions(): boolean {
  const identityPath = convosIdentityPath();
  let currentIdentity = "";
  try {
    currentIdentity = fs.readFileSync(identityPath, "utf-8");
  } catch {
    return false;
  }
  const markerIdx = currentIdentity.indexOf(CUSTOM_INSTRUCTIONS_MARKER);
  if (markerIdx === -1) {
    return false;
  }
  const base = currentIdentity.slice(0, markerIdx).replace(/\n---\s*\n*$/, "").trimEnd();
  if (base) {
    fs.writeFileSync(identityPath, `${base}\n`);
  } else {
    fs.rmSync(identityPath, { force: true });
  }
  console.log(`[convos] Cleared custom instructions from ${identityPath}`);
  return true;
}

async function clearPersistedBinding(
  accountId?: string,
  extraConversationIds: Iterable<string> = [],
): Promise<void> {
  const runtime = getConvosRuntime();
  const cfg = runtime.config.loadConfig() as Record<string, unknown>;
  const account = resolveConvosAccount({ cfg: cfg as CoreConfig, accountId });
  const channels = (cfg.channels ?? {}) as Record<string, unknown>;
  const convos = { ...(channels.convos ?? {}) as Record<string, unknown> };
  const conversationIds = new Set<string>(extraConversationIds);

  if (account.ownerConversationId) {
    conversationIds.add(account.ownerConversationId);
  }

  delete convos.identityId;
  delete convos.ownerConversationId;

  await runtime.config.writeConfigFile({
    ...cfg,
    channels: { ...channels, convos },
  });

  clearConvosCredentials();
  delete process.env.CONVOS_CONVERSATION_ID;

  conversationIds.add(account.ownerConversationId ?? "status-probe");

  for (const conversationId of conversationIds) {
    clearConvosSessionState(conversationId);
  }
}

function clearCliIdentityState(): void {
  const convosHome = convosHomeDir();
  for (const entry of ["identities", "db"]) {
    const target = path.join(convosHome, entry);
    try {
      fs.rmSync(target, { recursive: true, force: true });
      console.log(`[convos] Cleared ${target}`);
    } catch (err) {
      console.warn(`[convos] Failed to clear ${target}: ${String(err)}`);
    }
  }
}

async function saveBoundConversation(params: {
  env: "production" | "dev";
  conversationId: string;
  identityId: string;
}): Promise<void> {
  const runtime = getConvosRuntime();
  const cfg = runtime.config.loadConfig();
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
        env: params.env,
        enabled: true,
      },
    },
  });

  saveConvosCredentials({
    identityId: params.identityId,
    ownerConversationId: params.conversationId,
  });

  await startWiredInstance({
    conversationId: params.conversationId,
    identityId: params.identityId,
    env: params.env,
  });
}

async function notifyPoolPendingJoin(event: "claimed" | "tainted", params: {
  conversationId?: string;
  error?: string;
}): Promise<void> {
  const poolUrl = process.env.POOL_URL;
  const instanceId = process.env.INSTANCE_ID;
  const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;
  if (!poolUrl || !instanceId || !gatewayToken) {
    return;
  }

  const endpoint = event === "claimed"
    ? `${poolUrl}/api/pool/pending-acceptance/complete`
    : `${poolUrl}/api/pool/pending-acceptance/fail`;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instanceId,
        gatewayToken,
        conversationId: params.conversationId ?? null,
        error: params.error ?? null,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(`[convos] Pending join pool callback failed: ${res.status} ${text.slice(0, 500)}`);
    }
  } catch (err) {
    console.warn(`[convos] Pending join pool callback failed: ${String(err)}`);
  }
}

async function factoryReset(accountId?: string) {
  const resetGeneration = provisionGeneration + 1;
  provisionGeneration = resetGeneration;
  const pendingAbort = pendingJoinAbortController;
  const pendingPromise = pendingJoinPromise;
  provisionState = null;
  pendingJoinAbortController = null;
  pendingJoinPromise = null;
  writePersistedPendingJoin(null);
  pendingAbort?.abort();
  if (pendingPromise) {
    await pendingPromise.catch(() => {});
  }

  const conversationIds = new Set<string>();
  const inst = getConvosInstance();
  if (inst) {
    conversationIds.add(inst.conversationId);
    await inst.stop();
    setConvosInstance(null);
  }
  await clearPersistedBinding(accountId, conversationIds);
  clearCustomInstructions();
  clearCliIdentityState();
  clearConvosMediaState();
  clearPendingCompanionState();
  return { ok: true, reset: true, status: buildRuntimeStatus(), generation: resetGeneration };
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

function isProvisionBusy(): boolean {
  return getProvisionStatus().state !== "idle";
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

    api.registerGatewayMethod("convos.reset", async ({ params, respond }) => {
      try {
        const result = await factoryReset(
          typeof params.accountId === "string" ? params.accountId : undefined,
        );
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
          if (isProvisionBusy()) {
            jsonResponse(res, 409, {
              error:
                "Instance already has active convos state. Reset it before provisioning again.",
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
          const generation = setProvisionState("creating");

          try {
            const { instance, result } = await ConvosInstance.create(env, {
              name,
              profileName,
              description,
              imageUrl,
              permissions,
            });

            await saveBoundConversation({
              env,
              conversationId: result.conversationId,
              identityId: instance.identityId,
            });
            clearProvisionState(generation);

            jsonResponse(res, 200, {
              conversationId: result.conversationId,
              inviteUrl: result.inviteUrl,
              inviteSlug: result.inviteSlug,
            });
          } catch (err) {
            updateProvisionState(generation, {
              state: "failed",
              watching: false,
              lastError: err instanceof Error ? err.message : String(err),
            });
            throw err;
          }
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
          if (isProvisionBusy()) {
            jsonResponse(res, 409, {
              error:
                "Instance already has active convos state. Reset it before provisioning again.",
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
          const generation = setProvisionState("joining", { inviteUrl });
          const abortController = new AbortController();
          const joinPromise = ConvosInstance.join(env, inviteUrl, {
            profileName,
            timeout: PENDING_JOIN_TIMEOUT_SECONDS,
            signal: abortController.signal,
          });

          const onPendingJoinSettled = async () => {
            try {
              const { instance, status, conversationId } = await joinPromise;
              if (generation !== provisionGeneration) {
                return;
              }
              pendingJoinAbortController = null;
              pendingJoinPromise = null;

              if (status !== "joined" || !conversationId || !instance) {
                updateProvisionState(generation, {
                  state: "failed",
                  watching: false,
                  lastError: "Join timed out without approval",
                });
                await notifyPoolPendingJoin("tainted", {
                  error: "Join timed out without approval",
                });
                return;
              }

              await saveBoundConversation({
                env,
                conversationId,
                identityId: instance.identityId,
              });
              clearProvisionState(generation);
              await notifyPoolPendingJoin("claimed", { conversationId });
            } catch (err) {
              if (generation !== provisionGeneration) {
                return;
              }
              pendingJoinAbortController = null;
              pendingJoinPromise = null;
              const aborted = err instanceof Error && err.name === "AbortError";
              if (aborted) {
                return;
              }
              updateProvisionState(generation, {
                state: "failed",
                watching: false,
                lastError: err instanceof Error ? err.message : String(err),
              });
              await notifyPoolPendingJoin("tainted", {
                error: err instanceof Error ? err.message : String(err),
              });
            }
          };

          const outcome = await Promise.race([
            joinPromise.then((result) => ({ type: "result" as const, result })),
            new Promise<{ type: "timeout" }>((resolve) => {
              setTimeout(() => resolve({ type: "timeout" }), JOIN_RESPONSE_WAIT_MS);
            }),
          ]);

          if (outcome.type === "timeout") {
            pendingJoinAbortController = abortController;
            pendingJoinPromise = onPendingJoinSettled();
            updateProvisionState(generation, {
              state: "pending_acceptance",
              watching: true,
              lastError: null,
            });
            jsonResponse(res, 200, { status: "pending_acceptance" });
            return;
          }

          const { instance, status, conversationId } = outcome.result;
          if (status !== "joined" || !conversationId || !instance) {
            updateProvisionState(generation, {
              state: "pending_acceptance",
              watching: false,
              lastError: "Join is still waiting for acceptance",
            });
            jsonResponse(res, 200, { status: "pending_acceptance" });
            return;
          }

          await saveBoundConversation({
            env,
            conversationId,
            identityId: instance.identityId,
          });
          clearProvisionState(generation);
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

    // Health/status: reports whether the instance is bound and streaming.
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

    // Reset: stop the active runtime and clear local Convos state.
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
          const body = await readJsonBody(req);
          const result = await factoryReset(
            typeof body.accountId === "string" ? body.accountId : undefined,
          );
          jsonResponse(res, 200, result);
        } catch (err) {
          jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      },
    });
  },
};

export default plugin;
