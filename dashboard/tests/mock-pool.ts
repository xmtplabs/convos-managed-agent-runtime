import express from "express";
import { readFileSync } from "fs";
import { resolve } from "path";

const app = express();
app.use(express.json());

// --- CORS (before routes so preflight works) ---

app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (_req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// --- Fixture data ---

const CATALOG = (() => {
  const fixturePath = resolve(__dirname, "fixtures/catalog.json");
  try {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    if (!Array.isArray(raw) || raw.length === 0) {
      console.error(`[mock-pool] WARNING: catalog fixture at ${fixturePath} is empty or not an array`);
    }
    return raw;
  } catch (err) {
    console.error(`[mock-pool] FATAL: Could not load catalog fixture at ${fixturePath}:`, err);
    throw new Error(`Missing or invalid catalog fixture: ${fixturePath}`);
  }
})();

const MOCK_PROMPT = {
  prompt: "You are a helpful AI assistant. You help users with meal planning, grocery lists, and recipe suggestions. Be friendly and concise.",
};

const COUNTS: Record<string, { idle: number; starting: number; claimed: number; crashed: number }> = {
  idle:      { idle: 3, starting: 0, claimed: 1, crashed: 0 },
  empty:     { idle: 0, starting: 0, claimed: 0, crashed: 0 },
  success:   { idle: 3, starting: 0, claimed: 1, crashed: 0 },
  error:     { idle: 3, starting: 0, claimed: 1, crashed: 0 },
  "qr-modal": { idle: 3, starting: 0, claimed: 1, crashed: 0 },
};

const CLAIM_RESPONSES: Record<string, { status: number; body: object }> = {
  idle:      { status: 200, body: { joined: true, instanceId: "mock-inst-1" } },
  empty:     { status: 503, body: { error: "No idle instances available. Try again in a few minutes." } },
  success:   { status: 200, body: { joined: true, instanceId: "mock-inst-1" } },
  error:     { status: 500, body: { error: "Connection failed" } },
  "qr-modal": { status: 200, body: { joined: false, inviteUrl: "https://converse.xyz/dm/mock-invite", agentName: "Meal Planner" } },
};

const EXPECTED_API_KEY = process.env.MOCK_API_KEY || "mock-key";

// --- Mutable state ---

let currentState = "idle";

// --- Control endpoint (test-only) ---

app.post("/_control/state", (req, res) => {
  const { state } = req.body;
  if (!COUNTS[state]) return res.status(400).json({ error: `Unknown state: ${state}`, valid: Object.keys(COUNTS) });
  currentState = state;
  res.json({ ok: true, state: currentState });
});

app.get("/_control/state", (_req, res) => {
  res.json({ state: currentState });
});

// --- Pool API endpoints ---

app.get("/api/pool/counts", (_req, res) => {
  res.json(COUNTS[currentState] || COUNTS.idle);
});

app.get("/api/pool/templates", (_req, res) => {
  res.json(CATALOG);
});

app.get("/api/pool/templates/:slug", (req, res) => {
  const t = CATALOG.find((a: any) => a.slug === req.params.slug);
  if (!t) return res.status(404).json({ error: "Template not found" });
  res.json(t);
});

app.post("/api/pool/claim", (req, res) => {
  // Validate authorization header (mirrors real Pool auth check)
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${EXPECTED_API_KEY}`) {
    return res.status(401).json({ error: "Unauthorized: missing or invalid API key" });
  }
  const response = CLAIM_RESPONSES[currentState] || CLAIM_RESPONSES.idle;
  res.status(response.status).json(response.body);
});

app.get("/api/prompts/:pageId", (req, res) => {
  if (!/^[a-f0-9]{32}$/.test(req.params.pageId)) {
    return res.status(400).json({ error: "Invalid page ID" });
  }
  res.json(MOCK_PROMPT);
});

// --- Start server ---

const PORT = parseInt(process.env.MOCK_POOL_PORT || "3002", 10);
app.listen(PORT, () => console.log(`[mock-pool] listening on :${PORT} (${CATALOG.length} templates loaded)`));
export { app };
