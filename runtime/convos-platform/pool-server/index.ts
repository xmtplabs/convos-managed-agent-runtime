#!/usr/bin/env node
/**
 * Shared Pool Server — container entrypoint for pool-managed instances.
 *
 * Sits in front of both OpenClaw and Hermes runtimes, providing a unified
 * pool management API.  Spawns the runtime on an internal port and proxies
 * all non-pool traffic to it.
 *
 * Serves (on public PORT):
 *   GET  /pool/health      → { ready, version, runtime }
 *   POST /pool/restart     → kill + respawn runtime process
 *   POST /pool/provision   → create/join conversation via internal runtime
 *   POST /pool/self-destruct → request instance destruction from pool manager
 *   *                      → proxy to internal runtime (HTTP + WebSocket)
 */

import http from "node:http";
import net from "node:net";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { spawn, type ChildProcess } from "node:child_process";

// ---------------------------------------------------------------------------
// Runtime configuration
// ---------------------------------------------------------------------------

type RuntimeType = "openclaw" | "hermes";

interface RuntimeConfig {
  name: RuntimeType;
  /** Working directory for the spawned runtime process. */
  cwd: string;
  /** Command + args for the initial boot (full init chain). */
  initialCmd: [string, string[]];
  /** Command + args for subsequent restarts (skip init, faster). */
  restartCmd: [string, string[]];
  /** HTTP path to poll for readiness. */
  readinessPath: string;
  /** Extra env vars to pass to the spawned process. */
  extraEnv: Record<string, string>;
}

function findAncestor(start: string, marker: string): string | null {
  let dir = path.resolve(start);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, marker))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// Anchor-based root resolution — immune to directory-level changes.
const POOL_SERVER_DIR = __dirname;
const PLATFORM_ROOT = findAncestor(POOL_SERVER_DIR, "convos-platform") || path.resolve(POOL_SERVER_DIR, "../..");

const RUNTIME_TYPE = (process.env.RUNTIME_TYPE || "openclaw") as RuntimeType;
if (RUNTIME_TYPE !== "openclaw" && RUNTIME_TYPE !== "hermes") {
  console.error(`[pool-server] Invalid RUNTIME_TYPE: ${RUNTIME_TYPE}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Volume setup — Railway startCommand bypasses Docker ENTRYPOINT, so we
// handle persistent volume redirection here.
// ---------------------------------------------------------------------------

const VOLUME_MOUNT = process.env.RAILWAY_VOLUME_MOUNT_PATH;

function setupOpenClawVolume(mountPath: string): void {
  process.env.OPENCLAW_STATE_DIR = path.join(mountPath, "openclaw");
  const convosVolDir = path.join(mountPath, "convos");
  const convosHome = path.join(os.homedir(), ".convos");
  fs.mkdirSync(convosVolDir, { recursive: true });
  try { fs.rmSync(convosHome, { recursive: true, force: true }); } catch {}
  try { fs.symlinkSync(convosVolDir, convosHome); } catch {}
  console.log(`[pool-server] Volume: state → ${process.env.OPENCLAW_STATE_DIR}, ~/.convos → ${convosVolDir}`);
}

function setupHermesVolume(mountPath: string): void {
  const hermesHome = path.join(mountPath, "hermes");
  process.env.HERMES_HOME = hermesHome;
  for (const sub of ["workspace/skills", "memories", "sessions", "cron"]) {
    fs.mkdirSync(path.join(hermesHome, sub), { recursive: true });
  }
  process.env.SKILLS_ROOT = path.join(hermesHome, "skills");
  process.env.WORKSPACE_SKILLS = path.join(hermesHome, "workspace", "skills");

  // Persist convos-cli identity keys on the volume (same as entrypoint.sh).
  const convosVolDir = path.join(mountPath, "convos");
  const convosHome = path.join(os.homedir(), ".convos");
  fs.mkdirSync(convosVolDir, { recursive: true });
  try { fs.rmSync(convosHome, { recursive: true, force: true }); } catch {}
  try { fs.symlinkSync(convosVolDir, convosHome); } catch {}
  console.log(`[pool-server] Volume: HERMES_HOME → ${hermesHome}, ~/.convos → ${convosVolDir}`);
}

if (VOLUME_MOUNT) {
  if (RUNTIME_TYPE === "openclaw") {
    setupOpenClawVolume(VOLUME_MOUNT);
  } else {
    setupHermesVolume(VOLUME_MOUNT);
  }
}

// ---------------------------------------------------------------------------
// Version resolution
// ---------------------------------------------------------------------------

const RUNTIME_VERSION = (() => {
  const candidates = [
    path.join(PLATFORM_ROOT, "package.json"),       // runtime/package.json (local dev)
    path.join(PLATFORM_ROOT, RUNTIME_TYPE, "runtime-version.json"), // Docker
    "/app/runtime-version.json",                    // Docker fallback
  ];
  for (const p of candidates) {
    try {
      const raw = fs.readFileSync(p, "utf8");
      const v = JSON.parse(raw).version as string | undefined;
      if (v) { console.log(`[pool-server] Version ${v} from ${p}`); return v; }
    } catch {}
  }
  console.warn(`[pool-server] Could not resolve version from: ${candidates.join(", ")}`);
  return "unknown";
})();
process.env.RUNTIME_VERSION = RUNTIME_VERSION;

// ---------------------------------------------------------------------------
// Runtime config
// ---------------------------------------------------------------------------

function buildRuntimeConfig(): RuntimeConfig {
  // In Docker both runtimes live at /app (scripts/ at /app/scripts/).
  // In local dev the runtime dirs sit alongside convos-platform/ (e.g. runtime/openclaw/).
  // RUNTIME_CWD env var allows explicit override for non-standard layouts.
  const runtimeRoot = process.env.RUNTIME_CWD
    || (fs.existsSync("/app/scripts/start.sh") ? "/app" : null)
    || path.resolve(PLATFORM_ROOT, RUNTIME_TYPE);
  const cwd = runtimeRoot;

  if (RUNTIME_TYPE === "openclaw") {
    return {
      name: "openclaw",
      cwd,
      initialCmd: ["pnpm", ["start"]],
      restartCmd: ["sh", ["scripts/start.sh"]],
      readinessPath: "/__openclaw__/canvas/",
      extraEnv: {
        OPENCLAW_PUBLIC_PORT: String(INTERNAL_PORT),
        OPENCLAW_GATEWAY_TOKEN: process.env.GATEWAY_TOKEN || "",
        POOL_SERVER_PORT: String(PORT),
      },
    };
  }

  return {
    name: "hermes",
    cwd,
    initialCmd: ["pnpm", ["start"]],
    restartCmd: ["pnpm", ["start"]],
    readinessPath: "/health",
    extraEnv: {},
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || "8080", 10);
const INTERNAL_PORT = parseInt(process.env.GATEWAY_INTERNAL_PORT || "18789", 10);
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN;
const INSTANCE_ID = process.env.INSTANCE_ID;
const POOL_URL = process.env.POOL_URL;

const config = buildRuntimeConfig();
console.log(`[pool-server] Runtime: ${config.name}, cwd: ${config.cwd}`);

// ---------------------------------------------------------------------------
// Gateway lifecycle
// ---------------------------------------------------------------------------

let gatewayReady = false;
let convosReady = false;
let restarting = false;
let gatewayChild: ChildProcess | null = null;

function spawnRuntime(cmd: [string, string[]], extraEnv: Record<string, string> = {}): ChildProcess {
  gatewayReady = false;
  convosReady = false;

  const child = spawn(cmd[0], cmd[1], {
    cwd: config.cwd,
    stdio: "inherit",
    detached: true,
    env: {
      ...process.env,
      ...config.extraEnv,
      ...extraEnv,
      PORT: String(INTERNAL_PORT),
    },
  });

  child.on("exit", (code) => {
    console.error(`[pool-server] Runtime exited with code ${code}`);
    if (!restarting) process.exit(code ?? 1);
  });

  gatewayChild = child;
  return child;
}

async function pollReadiness(): Promise<void> {
  const url = `http://localhost:${INTERNAL_PORT}${config.readinessPath}`;
  const headers: Record<string, string> = {};
  if (GATEWAY_TOKEN) headers["Authorization"] = `Bearer ${GATEWAY_TOKEN}`;

  for (let i = 1; i <= 120; i++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        console.log(`[pool-server] Runtime ready after ${i}s`);
        gatewayReady = true;
        return;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error("[pool-server] Runtime failed to start within 120s");
  process.exit(1);
}

// Initial boot — full init chain
spawnRuntime(config.initialCmd);
pollReadiness();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString();
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function checkAuth(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (!GATEWAY_TOKEN) return true;
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (match?.[1] === GATEWAY_TOKEN) return true;
  json(res, 401, { error: "Unauthorized" });
  return false;
}

// ---------------------------------------------------------------------------
// Convos invite/join helper
// ---------------------------------------------------------------------------

async function callConvosWithRetry(
  agentName: string,
  instructions: string,
  joinUrl: string | undefined,
  profileImage: string | undefined,
  metadata: Record<string, string> | undefined,
  maxAttempts = 30,
): Promise<{ inviteUrl?: string; conversationId?: string; joined: boolean; status?: string }> {
  const gatewayUrl = `http://localhost:${INTERNAL_PORT}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (GATEWAY_TOKEN) headers["Authorization"] = `Bearer ${GATEWAY_TOKEN}`;
  let lastError: Error | undefined;

  for (let i = 1; i <= maxAttempts; i++) {
    try {
      if (joinUrl) {
        const res = await fetch(`${gatewayUrl}/convos/join`, {
          method: "POST",
          headers,
          body: JSON.stringify({ inviteUrl: joinUrl, profileName: agentName, profileImage, metadata, instructions }),
          signal: AbortSignal.timeout(65_000),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`/convos/join returned ${res.status}: ${text}`);
        }
        const data = await res.json() as Record<string, unknown>;
        if (data.status === "pending_acceptance" || data.status === "waiting_for_acceptance") {
          console.log(`[pool-server] Join pending acceptance on attempt ${i}`);
          return { conversationId: undefined, inviteUrl: joinUrl, joined: false, status: "pending_acceptance" };
        }
        console.log(`[pool-server] Joined conversation on attempt ${i}: ${data.conversationId}`);
        return { conversationId: data.conversationId as string, inviteUrl: joinUrl, joined: true };
      } else {
        const res = await fetch(`${gatewayUrl}/convos/conversation`, {
          method: "POST",
          headers,
          body: JSON.stringify({ name: agentName, profileName: agentName, profileImage, metadata, instructions }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`/convos/conversation returned ${res.status}: ${text}`);
        }
        const data = await res.json() as Record<string, unknown>;
        console.log(`[pool-server] Created conversation on attempt ${i}: ${data.inviteUrl}`);
        return { inviteUrl: data.inviteUrl as string, conversationId: data.conversationId as string, joined: false };
      }
    } catch (err) {
      lastError = err as Error;
      if (i < maxAttempts) {
        console.log(`[pool-server] Convos ${joinUrl ? "join" : "invite"} attempt ${i}/${maxAttempts} failed, retrying in 1s...`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  throw new Error(`Convos ${joinUrl ? "join" : "invite"} failed after ${maxAttempts} attempts: ${lastError?.message}`);
}

// ---------------------------------------------------------------------------
// Pool HTTP server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  // GET /pool/health — no auth (used by Railway health checks and CI)
  if (req.method === "GET" && req.url === "/pool/health") {
    if (!gatewayReady) {
      json(res, 503, { ready: false });
      return;
    }
    if (!convosReady) {
      try {
        const headers: Record<string, string> = {};
        if (GATEWAY_TOKEN) headers["Authorization"] = `Bearer ${GATEWAY_TOKEN}`;
        const cRes = await fetch(`http://localhost:${INTERNAL_PORT}/convos/status`, {
          headers,
          signal: AbortSignal.timeout(3000),
        });
        if (cRes.ok) convosReady = true;
      } catch {}
    }
    json(res, convosReady ? 200 : 503, { ready: convosReady, version: RUNTIME_VERSION, runtime: config.name });
    return;
  }

  // POST /pool/restart
  if (req.method === "POST" && req.url === "/pool/restart") {
    if (!checkAuth(req, res)) return;

    let body: Record<string, unknown>;
    try {
      body = await readBody(req);
    } catch {
      json(res, 400, { error: "Invalid JSON body" });
      return;
    }

    const extraEnv = (body.env || {}) as Record<string, string>;
    Object.assign(process.env, extraEnv);

    try {
      restarting = true;
      if (gatewayChild) {
        console.log("[pool-server] Killing current runtime process group...");
        try { process.kill(-gatewayChild.pid!, "SIGTERM"); } catch {}
        await new Promise<void>((resolve) => {
          const onExit = () => resolve();
          gatewayChild!.once("exit", onExit);
          if (gatewayChild!.exitCode !== null) resolve();
        });
        await new Promise((r) => setTimeout(r, 2000));
      }
      restarting = false;

      console.log("[pool-server] Spawning new runtime...");
      spawnRuntime(config.restartCmd, extraEnv);
      await pollReadiness();

      json(res, 200, { ok: true });
    } catch (err) {
      restarting = false;
      const msg = err instanceof Error ? err.message : "Restart failed";
      console.error("[pool-server] restart failed:", err);
      json(res, 500, { error: msg });
    }
    return;
  }

  // POST /pool/provision
  if (req.method === "POST" && req.url === "/pool/provision") {
    if (!checkAuth(req, res)) return;

    if (!gatewayReady) {
      json(res, 503, { error: "Runtime not ready yet" });
      return;
    }

    let body: Record<string, unknown>;
    try {
      body = await readBody(req);
    } catch {
      json(res, 400, { error: "Invalid JSON body" });
      return;
    }

    const { agentName, instructions, joinUrl, profileImage, metadata } = body as {
      agentName?: string;
      instructions?: string;
      joinUrl?: string;
      profileImage?: string;
      metadata?: Record<string, string>;
    };
    if (!agentName || typeof agentName !== "string") {
      json(res, 400, { error: "agentName (string) is required" });
      return;
    }
    if (!instructions || typeof instructions !== "string") {
      json(res, 400, { error: "instructions (string) is required" });
      return;
    }

    try {
      const result = await callConvosWithRetry(agentName, instructions, joinUrl, profileImage, metadata);
      json(res, 200, {
        ok: true,
        inviteUrl: result.inviteUrl || null,
        conversationId: result.conversationId || null,
        joined: result.joined || false,
        status: result.status || (result.joined ? "joined" : "created"),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Provision failed";
      console.error("[pool-server] Provision failed:", err);
      json(res, 500, { error: msg });
    }
    return;
  }

  // POST /pool/self-destruct — localhost-only
  if (req.method === "POST" && req.url === "/pool/self-destruct") {
    const remoteAddr = req.socket.remoteAddress;
    if (remoteAddr !== "127.0.0.1" && remoteAddr !== "::1" && remoteAddr !== "::ffff:127.0.0.1") {
      json(res, 403, { error: "Self-destruct is localhost-only" });
      return;
    }

    if (!INSTANCE_ID || !POOL_URL || !GATEWAY_TOKEN) {
      console.log("[pool-server] Self-destruct skipped: INSTANCE_ID, POOL_URL, or GATEWAY_TOKEN not set");
      json(res, 200, { ok: false, reason: "not a pool-managed instance" });
      return;
    }

    const url = `${POOL_URL}/api/pool/self-destruct`;
    console.log(`[pool-server] Self-destruct requested, calling pool manager for instance ${INSTANCE_ID}`);

    try {
      const pmRes = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instanceId: INSTANCE_ID, gatewayToken: GATEWAY_TOKEN }),
        signal: AbortSignal.timeout(10_000),
      });
      console.log(`[pool-server] Pool manager responded: ${pmRes.status}`);
      if (!pmRes.ok) {
        const text = await pmRes.text().catch(() => "");
        console.error(`[pool-server] Pool manager rejected self-destruct: ${pmRes.status} ${text}`);
        json(res, 200, { ok: false, error: `Pool manager returned ${pmRes.status}` });
        return;
      }
      json(res, 200, { ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      console.error(`[pool-server] Self-destruct call failed: ${msg}`);
      json(res, 200, { ok: false, error: msg });
      return;
    }

    // Exit after responding — Railway will kill the service once pool manager destroys it.
    // Skip exit during evals so the container stays alive for result collection.
    if (!process.env.EVAL_MODE) {
      setTimeout(() => process.exit(0), 1000);
    }
    return;
  }

  // Proxy everything else to the runtime
  proxyRequest(req, res);
});

// ---------------------------------------------------------------------------
// HTTP proxy
// ---------------------------------------------------------------------------

function proxyRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  try {
    const proxyReq = http.request(
      { hostname: "localhost", port: INTERNAL_PORT, path: req.url, method: req.method, headers: req.headers },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode!, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );
    proxyReq.setTimeout(120_000, () => proxyReq.destroy());
    proxyReq.on("error", () => {
      if (!res.headersSent) json(res, 502, { error: "Runtime unavailable" });
    });
    req.pipe(proxyReq);
  } catch {
    json(res, 502, { error: "Runtime unavailable" });
  }
}

// ---------------------------------------------------------------------------
// WebSocket upgrade proxy
// ---------------------------------------------------------------------------

server.on("upgrade", (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
  const proxySocket = net.connect(INTERNAL_PORT, "localhost", () => {
    const headers = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      headers.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    }
    proxySocket.write(headers.join("\r\n") + "\r\n\r\n");
    if (head.length) proxySocket.write(head);
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });

  proxySocket.setTimeout(120_000, () => proxySocket.destroy());
  socket.setTimeout(120_000, () => socket.destroy());
  proxySocket.on("error", () => socket.destroy());
  socket.on("error", () => proxySocket.destroy());
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[pool-server] Listening on :${PORT}, ${config.name} runtime on :${INTERNAL_PORT}`);
});
