#!/usr/bin/env node
/**
 * Pool API — container entrypoint for pool-managed instances.
 *
 * On start: spawns `pnpm start` (gateway) on an internal port and polls
 * until deployed (same approach as qa.yml).
 *
 * Serves (on public PORT):
 *   GET  /pool/health    → { ready: boolean }
 *   POST /pool/provision → write AGENTS.md, return { ok: true }
 */

const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const { getStateDir } = require("./context.cjs");

const PORT = parseInt(process.env.PORT || "8080", 10);
const INTERNAL_PORT = parseInt(process.env.GATEWAY_INTERNAL_PORT || "18789", 10);
const AUTH_TOKEN = process.env.GATEWAY_AUTH_TOKEN;
const ROOT = path.resolve(__dirname, "..");

let gatewayReady = false;

// --- Start gateway on internal port ---

const child = spawn("pnpm", ["start"], {
  cwd: ROOT,
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: String(INTERNAL_PORT),
    OPENCLAW_PUBLIC_PORT: String(INTERNAL_PORT),
    OPENCLAW_GATEWAY_TOKEN: AUTH_TOKEN || process.env.OPENCLAW_GATEWAY_TOKEN || "",
  },
});

child.on("exit", (code) => {
  console.error(`[pool-server] Gateway exited with code ${code}`);
  process.exit(code ?? 1);
});

// Poll gateway until deployed (same as qa.yml)
async function pollGateway() {
  const url = `http://localhost:${INTERNAL_PORT}/__openclaw__/canvas/`;
  for (let i = 1; i <= 120; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
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
  if (!AUTH_TOKEN) return true;
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match || match[1] !== AUTH_TOKEN) {
    json(res, 401, { error: "Unauthorized" });
    return false;
  }
  return true;
}

// --- Pool HTTP server ---

const server = http.createServer(async (req, res) => {
  // GET /pool/health
  if (req.method === "GET" && req.url === "/pool/health") {
    if (!checkAuth(req, res)) return;
    json(res, 200, { ready: gatewayReady });
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

    const { agentName, instructions } = body;
    if (!agentName || typeof agentName !== "string") {
      json(res, 400, { error: "agentName (string) is required" });
      return;
    }
    if (!instructions || typeof instructions !== "string") {
      json(res, 400, { error: "instructions (string) is required" });
      return;
    }

    try {
      const stateDir = getStateDir();
      const workspaceDir = path.join(stateDir, "workspace");
      fs.mkdirSync(workspaceDir, { recursive: true });
      const agentsPath = path.join(workspaceDir, "AGENTS.md");
      const existing = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, "utf8") : "";
      fs.writeFileSync(agentsPath, existing + "\n\n## Agent Instructions\n\n" + instructions);
      console.log(`[pool-server] Wrote AGENTS.md for "${agentName}"`);

      json(res, 200, { ok: true });
    } catch (err) {
      console.error("[pool-server] Provision failed:", err);
      json(res, 500, { error: err.message || "Provision failed" });
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
    proxyReq.on("error", () => json(res, 502, { error: "Gateway unavailable" }));
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

  proxySocket.on("error", () => socket.destroy());
  socket.on("error", () => proxySocket.destroy());
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[pool-server] Listening on :${PORT}, gateway on :${INTERNAL_PORT}`);
});
