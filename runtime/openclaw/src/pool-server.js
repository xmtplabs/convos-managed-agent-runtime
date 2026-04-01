#!/usr/bin/env node
/**
 * Pool API — container entrypoint for pool-managed instances.
 *
 * On start: spawns `pnpm start` (gateway) on an internal port and polls
 * until deployed (same approach as qa.yml).
 *
 * Serves (on public PORT):
 *   GET  /pool/health           → { ready: boolean }
 *   POST /pool/restart  → write env overrides to volume, restart start.sh
 *   POST /pool/provision        → invite/join convos (instructions written by convos extension), return { ok, inviteUrl?, conversationId?, joined }
 */

const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawn } = require("node:child_process");

// Railway startCommand bypasses Docker ENTRYPOINT, so do volume setup here.
// When a Railway volume is mounted, redirect OpenClaw state + convos identity to it.
const VOLUME_MOUNT = process.env.RAILWAY_VOLUME_MOUNT_PATH;
if (VOLUME_MOUNT) {
  process.env.OPENCLAW_STATE_DIR = path.join(VOLUME_MOUNT, "openclaw");
  const convosVolDir = path.join(VOLUME_MOUNT, "convos");
  const convosHome = path.join(os.homedir(), ".convos");
  fs.mkdirSync(convosVolDir, { recursive: true });
  try { fs.rmSync(convosHome, { recursive: true, force: true }); } catch {}
  try { fs.symlinkSync(convosVolDir, convosHome); } catch {}
  console.log(`[pool-server] Volume: state → ${process.env.OPENCLAW_STATE_DIR}, ~/.convos → ${convosVolDir}`);
}

const PORT = parseInt(process.env.PORT || "8080", 10);
const INTERNAL_PORT = parseInt(process.env.GATEWAY_INTERNAL_PORT || "18789", 10);
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
const INSTANCE_ID = process.env.INSTANCE_ID;
const POOL_URL = process.env.POOL_URL;
const ROOT = path.resolve(__dirname, "..");
const RUNTIME_VERSION = (() => {
  const candidates = [
    path.resolve(__dirname, "../../package.json"),          // runtime/package.json (local dev)
    path.resolve(__dirname, "../runtime-version.json"),     // /app/runtime-version.json (Docker)
  ];
  for (const p of candidates) {
    try {
      const raw = fs.readFileSync(p, "utf8");
      const v = JSON.parse(raw).version;
      if (v) { console.log(`[pool-server] Version ${v} from ${p}`); return v; }
    } catch {}
  }
  console.warn(`[pool-server] Could not resolve version from: ${candidates.join(", ")}`);
  return "unknown";
})();
process.env.RUNTIME_VERSION = RUNTIME_VERSION;

let gatewayReady = false;
let convosReady = false;
let restarting = false;
let gatewayChild = null;

// --- Gateway lifecycle ---

function spawnGateway(extraEnv = {}) {
  gatewayReady = false;
  convosReady = false;

  const child = spawn("sh", ["scripts/start.sh"], {
    cwd: ROOT,
    stdio: "inherit",
    detached: true, // own process group so we can kill the entire tree on restart
    env: {
      ...process.env,
      ...extraEnv,
      PORT: String(INTERNAL_PORT),
      OPENCLAW_PUBLIC_PORT: String(INTERNAL_PORT),
      OPENCLAW_GATEWAY_TOKEN: process.env.OPENCLAW_GATEWAY_TOKEN || "",
      POOL_SERVER_PORT: String(PORT),
    },
  });

  child.on("exit", (code) => {
    console.error(`[pool-server] Gateway exited with code ${code}`);
    if (!restarting) process.exit(code ?? 1);
  });

  gatewayChild = child;
  return child;
}

async function pollGateway() {
  const url = `http://localhost:${INTERNAL_PORT}/__openclaw__/canvas/`;
  const headers = {};
  if (GATEWAY_TOKEN) headers["Authorization"] = `Bearer ${GATEWAY_TOKEN}`;
  for (let i = 1; i <= 120; i++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        console.log(`[pool-server] Gateway ready after ${i}s`);
        gatewayReady = true;
        return;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error("[pool-server] Gateway failed to start within 120s");
  process.exit(1);
}

// Initial start uses pnpm start (full init chain) for first boot
const initialChild = spawn("pnpm", ["start"], {
  cwd: ROOT,
  stdio: "inherit",
  detached: true, // own process group so restart can kill the entire tree
  env: {
    ...process.env,
    PORT: String(INTERNAL_PORT),
    OPENCLAW_PUBLIC_PORT: String(INTERNAL_PORT),
    OPENCLAW_GATEWAY_TOKEN: process.env.OPENCLAW_GATEWAY_TOKEN || "",
    POOL_SERVER_PORT: String(PORT),
  },
});

initialChild.on("exit", (code) => {
  console.error(`[pool-server] Gateway exited with code ${code}`);
  if (!restarting) process.exit(code ?? 1);
});

gatewayChild = initialChild;
pollGateway();

// --- Helpers ---

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
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

function checkAuth(req, res) {
  if (!GATEWAY_TOKEN) return true;
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (match?.[1] === GATEWAY_TOKEN) return true;
  json(res, 401, { error: "Unauthorized" });
  return false;
}

// --- Convos invite/join helper ---

async function callConvosWithRetry(agentName, instructions, joinUrl, profileImage, metadata, maxAttempts = 30) {
  const gatewayUrl = `http://localhost:${INTERNAL_PORT}`;
  const headers = { "Content-Type": "application/json" };
  if (GATEWAY_TOKEN) headers["Authorization"] = `Bearer ${GATEWAY_TOKEN}`;
  let lastError;

  for (let i = 1; i <= maxAttempts; i++) {
    try {
      if (joinUrl) {
        // Join an existing conversation
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
        const data = await res.json();
        // pending_acceptance: join is waiting for approval — return immediately
        if (data.status === "pending_acceptance") {
          console.log(`[pool-server] Join pending acceptance on attempt ${i}`);
          return { conversationId: null, inviteUrl: joinUrl, joined: false, status: "pending_acceptance" };
        }
        console.log(`[pool-server] Joined conversation on attempt ${i}: ${data.conversationId}`);
        return { conversationId: data.conversationId, inviteUrl: joinUrl, joined: true };
      } else {
        // Create a new conversation (instructions written to INSTRUCTIONS.md by convos extension)
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
        const data = await res.json();
        console.log(`[pool-server] Created conversation on attempt ${i}: ${data.inviteUrl}`);
        return { inviteUrl: data.inviteUrl, conversationId: data.conversationId, joined: false };
      }
    } catch (err) {
      lastError = err;
      if (i < maxAttempts) {
        console.log(`[pool-server] Convos ${joinUrl ? "join" : "invite"} attempt ${i}/${maxAttempts} failed, retrying in 1s...`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  throw new Error(`Convos ${joinUrl ? "join" : "invite"} failed after ${maxAttempts} attempts: ${lastError?.message}`);
}

// --- Pool HTTP server ---

const server = http.createServer(async (req, res) => {
  // GET /pool/health — no auth required (used by Railway health checks and CI)
  if (req.method === "GET" && req.url === "/pool/health") {
    if (!gatewayReady) {
      json(res, 200, { ready: false });
      return;
    }
    // Once convos is ready, cache it — no need to re-check
    if (!convosReady) {
      try {
        const headers = {};
        if (GATEWAY_TOKEN) headers["Authorization"] = `Bearer ${GATEWAY_TOKEN}`;
        const cRes = await fetch(`http://localhost:${INTERNAL_PORT}/convos/status`, {
          headers,
          signal: AbortSignal.timeout(3000),
        });
        if (cRes.ok) {
          convosReady = true;
        }
      } catch {}
    }
    json(res, 200, { ready: convosReady, version: RUNTIME_VERSION, runtime: "openclaw" });
    return;
  }

  // POST /pool/restart
  if (req.method === "POST" && req.url === "/pool/restart") {
    if (!checkAuth(req, res)) return;

    let body;
    try {
      body = await readBody(req);
    } catch {
      json(res, 400, { error: "Invalid JSON body" });
      return;
    }

    const extraEnv = body.env || {};

    // Merge into process.env so the new child inherits them
    Object.assign(process.env, extraEnv);

    try {
      restarting = true;
      if (gatewayChild) {
        console.log("[pool-server] Killing current gateway process group...");
        // Kill the entire process group (shell + gateway + children) so the
        // port is fully released before we respawn.
        try { process.kill(-gatewayChild.pid, "SIGTERM"); } catch {}
        // Wait for the child to exit
        await new Promise((resolve) => {
          const onExit = () => resolve();
          gatewayChild.once("exit", onExit);
          if (gatewayChild.exitCode !== null) resolve();
        });
        // Small grace period for OS to release sockets
        await new Promise((r) => setTimeout(r, 2000));
      }
      restarting = false;

      console.log("[pool-server] Spawning new gateway...");
      spawnGateway(extraEnv);
      await pollGateway();

      json(res, 200, { ok: true });
    } catch (err) {
      restarting = false;
      console.error("[pool-server] restart failed:", err);
      json(res, 500, { error: err.message || "Restart failed" });
    }
    return;
  }

  // POST /pool/provision
  if (req.method === "POST" && req.url === "/pool/provision") {
    if (!checkAuth(req, res)) return;

    if (!gatewayReady) {
      json(res, 503, { error: "Gateway not ready yet" });
      return;
    }

    let body;
    try {
      body = await readBody(req);
    } catch {
      json(res, 400, { error: "Invalid JSON body" });
      return;
    }

    const { agentName, instructions, joinUrl, profileImage, metadata } = body;
    if (!agentName || typeof agentName !== "string") {
      json(res, 400, { error: "agentName (string) is required" });
      return;
    }
    if (!instructions || typeof instructions !== "string") {
      json(res, 400, { error: "instructions (string) is required" });
      return;
    }

    try {
      // Create or join conversation — convos extension writes INSTRUCTIONS.md with the instructions
      const convosResult = await callConvosWithRetry(agentName, instructions, joinUrl, profileImage, metadata);

      json(res, 200, {
        ok: true,
        inviteUrl: convosResult.inviteUrl || null,
        conversationId: convosResult.conversationId || null,
        joined: convosResult.joined || false,
        status: convosResult.status || (convosResult.joined ? "joined" : "created"),
      });
    } catch (err) {
      console.error("[pool-server] Provision failed:", err);
      json(res, 500, { error: err.message || "Provision failed" });
    }
    return;
  }

  // POST /pool/self-destruct — extension requests instance self-destruction.
  // Localhost-only to prevent external callers from triggering destruction.
  // External callers should use DELETE /api/pool/instances/:id on the pool manager.
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
      console.error(`[pool-server] Self-destruct call failed: ${err.message}`);
      json(res, 200, { ok: false, error: err.message });
      return;
    }

    // Exit after responding — Railway will kill the service once pool manager destroys it.
    // Skip exit during evals so the container stays alive for result collection.
    if (!process.env.EVAL_MODE) {
      setTimeout(() => process.exit(0), 1000);
    }
    return;
  }

  // Proxy everything else to the gateway
  proxyRequest(req, res);
});

function proxyRequest(req, res) {
  try {
    const proxyReq = http.request(
      { hostname: "localhost", port: INTERNAL_PORT, path: req.url, method: req.method, headers: req.headers },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );
    proxyReq.setTimeout(120_000, () => proxyReq.destroy());
    proxyReq.on("error", () => {
      if (!res.headersSent) json(res, 502, { error: "Gateway unavailable" });
    });
    req.pipe(proxyReq);
  } catch {
    json(res, 502, { error: "Gateway unavailable" });
  }
}

// --- WebSocket upgrade proxy ---
const net = require("node:net");

server.on("upgrade", (req, socket, head) => {
  const proxySocket = net.connect(INTERNAL_PORT, "localhost", () => {
    // Rebuild the raw HTTP upgrade request to forward to the gateway
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

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[pool-server] Listening on :${PORT}, gateway on :${INTERNAL_PORT}`);
});
