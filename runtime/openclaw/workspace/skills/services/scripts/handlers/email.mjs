#!/usr/bin/env node
/**
 * Email handler — send, send-calendar, poll via AgentMail REST API.
 *
 * When POOL_URL and INSTANCE_ID are set, calls are proxied through the pool
 * manager (no API key needed on the instance). Otherwise falls back to direct
 * AgentMail API calls for local development.
 *
 * Usage:
 *   node services.mjs email send --to <email> --subject <subj> --text <body> [--html <html>] [--attach <path>]
 *   node services.mjs email send-calendar --to <email> --ics <path> [--subject <subj>]
 *   node services.mjs email poll [--limit 20] [--labels unread] [--threads]
 */
import { readFileSync } from "fs";
import { resolve } from "path";

// Proxy mode: route through pool manager (no API key on instance)
const POOL_URL = process.env.POOL_URL;
const INSTANCE_ID = process.env.INSTANCE_ID;
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
const useProxy = !!(POOL_URL && INSTANCE_ID && GATEWAY_TOKEN);

// Direct mode: call AgentMail API directly (local dev)
const DIRECT_API = "https://api.agentmail.to/v0";
const apiKey = process.env.AGENTMAIL_API_KEY;
const inboxId = process.env.AGENTMAIL_INBOX_ID;

function requireEnv() {
  if (useProxy) return; // proxy mode — pool manager handles auth + inbox
  if (!apiKey) { console.error("Email service not configured: missing API key"); process.exit(1); }
  if (!inboxId) { console.error("Email service not configured: missing inbox"); process.exit(1); }
}

async function api(method, path, body) {
  let url, headers;
  if (useProxy) {
    // Proxy: /api/proxy/email/send, /api/proxy/email/messages, etc.
    url = `${POOL_URL}${path}`;
    headers = {
      Authorization: `Bearer ${INSTANCE_ID}:${GATEWAY_TOKEN}`,
      "Content-Type": "application/json",
    };
  } else {
    // Direct: AgentMail API
    url = `${DIRECT_API}${path}`;
    headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
  }

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.message || data?.error || JSON.stringify(data);
    throw new Error(`AgentMail ${res.status}: ${msg}`);
  }
  return data;
}

// In proxy mode, paths don't include inboxId (pool manager injects it)
function inboxPath(suffix) {
  if (useProxy) {
    // Proxy routes: /api/proxy/email/send, /api/proxy/email/messages, /api/proxy/email/threads
    // Strip "messages/" prefix for send since proxy has a dedicated /send route
    if (suffix === "messages/send") return "/api/proxy/email/send";
    return `/api/proxy/email/${suffix}`;
  }
  return `/inboxes/${inboxId}/${suffix}`;
}

function parseArgs(argv) {
  const map = {};
  const flags = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        map[key] = argv[++i];
      } else {
        flags.push(key);
      }
    }
  }
  return { map, flags };
}

async function send(argv) {
  requireEnv();
  const { map } = parseArgs(argv);
  const to = map.to;
  const subject = map.subject;
  const text = map.text;
  const html = map.html;
  const attachPath = map.attach;

  if (!to || !subject || text === undefined) {
    console.error("Usage: services.mjs email send --to <email> --subject <subj> --text <body> [--html <html>] [--attach <path>]");
    process.exit(1);
  }

  const payload = {
    to,
    subject,
    text: text || "",
    html: html ?? `<p>${(text || "").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`,
  };

  if (attachPath) {
    const abs = resolve(process.cwd(), attachPath);
    const raw = readFileSync(abs);
    const filename = attachPath.split("/").pop() || "attachment";
    const content_type = filename.endsWith(".ics") ? "text/calendar" : "application/octet-stream";
    payload.attachments = [
      { content: raw.toString("base64"), filename, content_type },
    ];
  }

  await api("POST", inboxPath("messages/send"), payload);
  console.log("Sent to", to);
}

async function sendCalendar(argv) {
  requireEnv();
  const { map } = parseArgs(argv);
  const to = map.to;
  const icsPath = map.ics;
  const subject = map.subject || "Calendar invite";

  if (!to || !icsPath) {
    console.error("Usage: services.mjs email send-calendar --to <email> --ics <path> [--subject <subj>]");
    process.exit(1);
  }

  const icsAbs = resolve(process.cwd(), icsPath);
  const icsContent = readFileSync(icsAbs, "utf8");
  const content = Buffer.from(icsContent, "utf8").toString("base64");

  await api("POST", inboxPath("messages/send"), {
    to,
    subject,
    text: "Calendar invite attached. Open the .ics file to add to your calendar.",
    html: "<p>Calendar invite attached. Open the .ics file to add to your calendar.</p>",
    attachments: [
      { content, filename: "invite.ics", content_type: "text/calendar" },
    ],
  });

  console.log("Sent calendar invite to", to);
}

async function poll(argv) {
  requireEnv();
  const { map, flags } = parseArgs(argv);
  const limit = parseInt(map.limit, 10) || 20;
  const labels = map.labels?.split(",").map((s) => s.trim()).filter(Boolean);
  const includeThreads = flags.includes("threads");

  const params = new URLSearchParams({ limit: String(limit) });
  if (labels?.length) labels.forEach((l) => params.append("labels", l));

  const out = { messages: [], threads: [] };

  const msgData = await api("GET", `${inboxPath("messages")}?${params}`);
  out.messages = msgData?.messages ?? [];

  if (includeThreads) {
    const threadParams = new URLSearchParams();
    threadParams.append("labels", "unreplied");
    const threadData = await api("GET", `${inboxPath("threads")}?${threadParams}`);
    out.threads = threadData?.threads ?? [];
  }

  if (flags.includes("json")) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  const displayInbox = inboxId || "(proxy)";
  console.log(`Inbox ${displayInbox}: ${out.messages.length} message(s)\n`);
  for (const m of out.messages) {
    const dir = m.labels?.includes("received") ? "received" : "sent";
    console.log(`  Subject: ${m.subject || "(none)"}`);
    console.log(`  From:    ${m.from}`);
    console.log(`  To:      ${[].concat(m.to || []).join(", ")}`);
    console.log(`  Date:    ${m.timestamp}`);
    console.log(`  Status:  ${dir}`);
    if (m.preview) console.log(`  Preview: ${m.preview.slice(0, 120)}`);
    console.log("");
  }
}

export default async function email(argv) {
  const [action, ...rest] = argv;

  switch (action) {
    case "send":          return send(rest);
    case "send-calendar": return sendCalendar(rest);
    case "poll":          return poll(rest);
    default:
      console.error("Usage: services.mjs email <send|send-calendar|poll> [options]");
      process.exit(1);
  }
}
