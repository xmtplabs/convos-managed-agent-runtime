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

/** Read OPENCLAW_GATEWAY_TOKEN from env so pages can auth to convos endpoints. */
function getGatewayToken(): string {
  return process.env.OPENCLAW_GATEWAY_TOKEN || "";
}

/** Serve an HTML page with the gateway token injected as a JS variable. */
function servePageWithToken(htmlPath: string, res: ServerResponse) {
  try {
    let html = fs.readFileSync(htmlPath, "utf-8");
    const token = getGatewayToken();
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

/** Serve the landing page with the gateway token injected as a JS variable. */
function serveLandingPage(agentsDir: string, res: ServerResponse) {
  servePageWithToken(path.join(agentsDir, "landing.html"), res);
}

/** Build service identity + credits data from pool proxy (or env fallback). */
async function getServicesData(): Promise<Record<string, unknown>> {
  const servicesUrl = buildServicesUrl();
  const instanceId = process.env.INSTANCE_ID || null;
  const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;
  const poolUrl = process.env.POOL_URL;
  const xmtpEnv = process.env.XMTP_ENV || "dev";

  let email: string | null = null;
  let phone: string | null = null;

  // Fetch identity from pool proxy (production) or fall back to env (local dev)
  if (instanceId && gatewayToken && poolUrl) {
    try {
      const infoRes = await fetch(`${poolUrl}/api/proxy/info`, {
        headers: { Authorization: `Bearer ${instanceId}:${gatewayToken}` },
        signal: AbortSignal.timeout(5_000),
      });
      if (infoRes.ok) {
        const info = await infoRes.json() as { email?: string; phone?: string };
        email = info.email || null;
        phone = info.phone || null;
      }
    } catch {}
  }
  // Direct mode fallback (local dev / QA only — live agents always use proxy)
  if (!email) email = process.env.AGENTMAIL_INBOX_ID || null;
  if (!phone) phone = process.env.TELNYX_PHONE_NUMBER || null;

  const result: Record<string, unknown> = { email, phone, servicesUrl, instanceId, xmtpEnv };

  if (instanceId && gatewayToken && poolUrl) {
    // Fetch OpenRouter credits and Convos (Stripe) balance in parallel
    const creditsPromise = fetch(`${poolUrl}/api/pool/credits-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceId, gatewayToken }),
      signal: AbortSignal.timeout(5_000),
    }).then(async (r) => {
      if (r.ok) return await r.json();
      const body = await r.text().catch(() => "");
      console.warn(`[web-tools] Credits check failed: ${r.status} ${body}`);
      return { error: "unavailable" };
    }).catch((err: any) => {
      console.warn(`[web-tools] Credits check error: ${err.message}`);
      return { error: "unavailable" };
    });

    const convosPromise = fetch(`${poolUrl}/api/pool/stripe/balance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceId, gatewayToken }),
      signal: AbortSignal.timeout(5_000),
    }).then(async (r) => {
      if (r.ok) return await r.json();
      return { balanceCents: 0 };
    }).catch(() => ({ balanceCents: 0 }));

    const cardPromise = fetch(`${poolUrl}/api/pool/stripe/card-info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceId, gatewayToken }),
      signal: AbortSignal.timeout(5_000),
    }).then(async (r) => {
      if (r.ok) return await r.json();
      return { hasCard: false };
    }).catch(() => ({ hasCard: false }));

    const [credits, convos, card] = await Promise.all([creditsPromise, convosPromise, cardPromise]);
    result.credits = credits;
    result.convosBalance = convos;
    result.card = card;
  } else {
    result.credits = { error: "not pool-managed" };
    result.convosBalance = { balanceCents: 0 };
  }

  return result;
}

function buildServicesUrl(): string {
  const domain = process.env.RAILWAY_PUBLIC_DOMAIN;
  const ngrok = process.env.NGROK_URL;
  const port = process.env.POOL_SERVER_PORT || process.env.PORT || "18789";
  const base = domain
    ? `https://${domain}`
    : ngrok
      ? ngrok.replace(/\/$/, "")
      : `http://127.0.0.1:${port}`;
  return `${base}/web-tools/services`;
}

export default function register(api: OpenClawPluginApi) {
  const agentsDir = path.resolve(__dirname, "convos");
  const servicesDir = path.resolve(__dirname, "services");

  api.registerHttpRoute({
    path: "/web-tools/convos",
    handler: async (req, res) => {
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.end();
        return;
      }
      serveLandingPage(agentsDir, res);
    },
  });

  api.registerHttpRoute({
    path: "/web-tools/convos/",
    handler: async (req, res) => {
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.end();
        return;
      }
      serveLandingPage(agentsDir, res);
    },
  });

  api.registerHttpRoute({
    path: "/web-tools/convos/manifest.json",
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
    path: "/web-tools/convos/sw.js",
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
    path: "/web-tools/convos/icon.svg",
    handler: async (req, res) => {
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.end();
        return;
      }
      serveFile(res, path.join(agentsDir, "icon.svg"), "image/svg+xml");
    },
  });

  // --- Services page ---

  api.registerHttpRoute({
    path: "/web-tools/services",
    handler: async (req, res) => {
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.end();
        return;
      }
      servePageWithToken(path.join(servicesDir, "services.html"), res);
    },
  });

  api.registerHttpRoute({
    path: "/web-tools/services/",
    handler: async (req, res) => {
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.end();
        return;
      }
      servePageWithToken(path.join(servicesDir, "services.html"), res);
    },
  });

  api.registerHttpRoute({
    path: "/web-tools/services/services.css",
    handler: async (req, res) => {
      try {
        const css = fs.readFileSync(path.join(servicesDir, "services.css"), "utf-8");
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/css; charset=utf-8");
        res.end(css);
      } catch {
        res.statusCode = 404;
        res.end();
      }
    },
  });

  api.registerHttpRoute({
    path: "/web-tools/services/api",
    handler: async (req, res) => {
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.end();
        return;
      }
      try {
        const data = await getServicesData();
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify(data));
      } catch {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Failed to load services data" }));
      }
    },
  });

  // Serve extracted CSS for services page
  api.registerHttpRoute({
    path: "/web-tools/services/services.css",
    handler: async (req, res) => {
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.end();
        return;
      }
      serveFile(res, path.join(servicesDir, "services.css"), "text/css", "max-age=3600");
    },
  });

  // Credits top-up proxy — forwards request to pool manager
  api.registerHttpRoute({
    path: "/web-tools/services/topup",
    handler: async (req, res) => {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.end();
        return;
      }

      const instanceId = process.env.INSTANCE_ID;
      const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;
      const poolUrl = process.env.POOL_URL;

      if (!instanceId || !gatewayToken || !poolUrl) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Top-up not available (missing config)" }));
        return;
      }

      try {
        const topupUrl = `${poolUrl}/api/pool/credits-topup`;
        console.log(`[web-tools] Credits top-up → ${topupUrl} (instance=${instanceId})`);
        const poolRes = await fetch(topupUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instanceId, gatewayToken }),
          signal: AbortSignal.timeout(10_000),
        });
        const body = await poolRes.json().catch(() => ({ error: "Invalid response" }));
        res.statusCode = poolRes.status;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(body));
      } catch (err: any) {
        console.warn(`[web-tools] Credits top-up error: ${err.message}`);
        res.statusCode = 502;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Failed to reach pool manager" }));
      }
    },
  });

  // Stripe config proxy — returns publishable key
  api.registerHttpRoute({
    path: "/web-tools/services/stripe-config",
    handler: async (req, res) => {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.end();
        return;
      }

      const instanceId = process.env.INSTANCE_ID;
      const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;
      const poolUrl = process.env.POOL_URL;

      if (!instanceId || !gatewayToken || !poolUrl) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Stripe not available (missing config)" }));
        return;
      }

      try {
        const url = `${poolUrl}/api/pool/stripe/config`;
        const poolRes = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instanceId, gatewayToken }),
          signal: AbortSignal.timeout(5_000),
        });
        const body = await poolRes.json().catch(() => ({ error: "Invalid response" }));
        res.statusCode = poolRes.status;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(body));
      } catch (err: any) {
        console.warn(`[web-tools] Stripe config error: ${err.message}`);
        res.statusCode = 502;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Failed to reach pool manager" }));
      }
    },
  });

  // Stripe create-payment proxy — creates PaymentIntent
  api.registerHttpRoute({
    path: "/web-tools/services/create-payment",
    handler: async (req, res) => {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.end();
        return;
      }

      const instanceId = process.env.INSTANCE_ID;
      const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;
      const poolUrl = process.env.POOL_URL;

      if (!instanceId || !gatewayToken || !poolUrl) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Payment not available (missing config)" }));
        return;
      }

      try {
        // Parse request body
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const bodyStr = Buffer.concat(chunks).toString();
        const parsed = JSON.parse(bodyStr || "{}");
        const amountCents = parsed.amountCents;
        const purpose = parsed.purpose === "card" ? "card" : "credits";

        const url = `${poolUrl}/api/pool/stripe/create-payment-intent`;
        const poolRes = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instanceId, gatewayToken, amountCents, purpose }),
          signal: AbortSignal.timeout(10_000),
        });
        const body = await poolRes.json().catch(() => ({ error: "Invalid response" }));
        res.statusCode = poolRes.status;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(body));
      } catch (err: any) {
        console.warn(`[web-tools] Create payment error: ${err.message}`);
        res.statusCode = 502;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Failed to reach pool manager" }));
      }
    },
  });

  // Coupon redemption proxy
  api.registerHttpRoute({
    path: "/web-tools/services/redeem-coupon",
    handler: async (req, res) => {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.end();
        return;
      }

      const instanceId = process.env.INSTANCE_ID;
      const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;
      const poolUrl = process.env.POOL_URL;

      if (!instanceId || !gatewayToken || !poolUrl) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Not available (missing config)" }));
        return;
      }

      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const bodyStr = Buffer.concat(chunks).toString();
        const parsed = JSON.parse(bodyStr || "{}");
        const code = parsed.code;

        const url = `${poolUrl}/api/pool/redeem-coupon`;
        const poolRes = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instanceId, gatewayToken, code }),
          signal: AbortSignal.timeout(10_000),
        });
        const body = await poolRes.json().catch(() => ({ error: "Invalid response" }));
        res.statusCode = poolRes.status;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(body));
      } catch (err: any) {
        console.warn(`[web-tools] Coupon redemption error: ${err.message}`);
        res.statusCode = 502;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Failed to reach pool manager" }));
      }
    },
  });

  // Stripe card request proxy — charges user + issues virtual card
  api.registerHttpRoute({
    path: "/web-tools/services/request-card",
    handler: async (req, res) => {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.end();
        return;
      }

      const instanceId = process.env.INSTANCE_ID;
      const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;
      const poolUrl = process.env.POOL_URL;

      if (!instanceId || !gatewayToken || !poolUrl) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Card not available (missing config)" }));
        return;
      }

      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const bodyStr = Buffer.concat(chunks).toString();
        const parsed = JSON.parse(bodyStr || "{}");
        const amountCents = parsed.amountCents;

        const url = `${poolUrl}/api/pool/stripe/request-card`;
        const poolRes = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instanceId, gatewayToken, amountCents }),
          signal: AbortSignal.timeout(30_000),
        });
        const body = await poolRes.json().catch(() => ({ error: "Invalid response" }));
        res.statusCode = poolRes.status;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(body));
      } catch (err: any) {
        console.warn(`[web-tools] Request card error: ${err.message}`);
        res.statusCode = 502;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Failed to reach pool manager" }));
      }
    },
  });

  // Stripe card info proxy — returns masked card details for display
  api.registerHttpRoute({
    path: "/web-tools/services/card-info",
    handler: async (req, res) => {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.end();
        return;
      }

      const instanceId = process.env.INSTANCE_ID;
      const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;
      const poolUrl = process.env.POOL_URL;

      if (!instanceId || !gatewayToken || !poolUrl) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Card info not available (missing config)" }));
        return;
      }

      try {
        const url = `${poolUrl}/api/pool/stripe/card-info`;
        const poolRes = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instanceId, gatewayToken }),
          signal: AbortSignal.timeout(5_000),
        });
        const body = await poolRes.json().catch(() => ({ error: "Invalid response" }));
        res.statusCode = poolRes.status;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(body));
      } catch (err: any) {
        console.warn(`[web-tools] Card info error: ${err.message}`);
        res.statusCode = 502;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Failed to reach pool manager" }));
      }
    },
  });

  // Stripe card details proxy — returns full card number/CVC (agent use only)
  api.registerHttpRoute({
    path: "/web-tools/services/card-details",
    handler: async (req, res) => {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.end();
        return;
      }

      const instanceId = process.env.INSTANCE_ID;
      const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;
      const poolUrl = process.env.POOL_URL;

      if (!instanceId || !gatewayToken || !poolUrl) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Card details not available (missing config)" }));
        return;
      }

      try {
        const url = `${poolUrl}/api/pool/stripe/card-details`;
        const poolRes = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instanceId, gatewayToken }),
          signal: AbortSignal.timeout(5_000),
        });
        const body = await poolRes.json().catch(() => ({ error: "Invalid response" }));
        res.statusCode = poolRes.status;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(body));
      } catch (err: any) {
        console.warn(`[web-tools] Card details error: ${err.message}`);
        res.statusCode = 502;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Failed to reach pool manager" }));
      }
    },
  });

  // Stripe balance proxy — returns customer balance
  api.registerHttpRoute({
    path: "/web-tools/services/stripe-balance",
    handler: async (req, res) => {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.end();
        return;
      }

      const instanceId = process.env.INSTANCE_ID;
      const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;
      const poolUrl = process.env.POOL_URL;

      if (!instanceId || !gatewayToken || !poolUrl) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Balance not available (missing config)" }));
        return;
      }

      try {
        const url = `${poolUrl}/api/pool/stripe/balance`;
        const poolRes = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instanceId, gatewayToken }),
          signal: AbortSignal.timeout(5_000),
        });
        const body = await poolRes.json().catch(() => ({ error: "Invalid response" }));
        res.statusCode = poolRes.status;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(body));
      } catch (err: any) {
        console.warn(`[web-tools] Stripe balance error: ${err.message}`);
        res.statusCode = 502;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Failed to reach pool manager" }));
      }
    },
  });
}
