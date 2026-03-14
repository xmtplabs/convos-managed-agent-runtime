#!/usr/bin/env node
/**
 * Email handler — send, send-calendar, poll via AgentMail REST API.
 *
 * When POOL_URL and INSTANCE_ID are set, calls are proxied through the pool
 * manager (no API key needed on the instance). Otherwise falls back to direct
 * AgentMail API calls for local development.
 *
 * In local Hermes eval mode (HERMES_EVAL_LOCAL_SERVICES=1), direct mode uses a
 * deterministic local store instead of external providers so evals stay stable.
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import {
  listLocalEmails,
  listRecentLocalEmails,
  localEmailAddress,
  localServicesEnabled,
  recordLocalEmail,
} from "./local-store.mjs";

const POOL_URL = process.env.POOL_URL;
const INSTANCE_ID = process.env.INSTANCE_ID;
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
const useProxy = !!(POOL_URL && INSTANCE_ID && GATEWAY_TOKEN);

const DIRECT_API = "https://api.agentmail.to/v0";
const apiKey = process.env.AGENTMAIL_API_KEY;
const inboxId = process.env.AGENTMAIL_INBOX_ID;

async function requireEnv() {
  if (localServicesEnabled() && !useProxy) return;

  if (!useProxy) {
    if (!apiKey) { console.error("Email service not configured: missing API key"); process.exit(1); }
    if (!inboxId) { console.error("Email service not configured: missing inbox"); process.exit(1); }
    return;
  }

  const infoRes = await fetch(`${POOL_URL}/api/proxy/info`, {
    headers: { Authorization: `Bearer ${INSTANCE_ID}:${GATEWAY_TOKEN}` },
  });
  if (!infoRes.ok) {
    console.error(`Email service info check failed: ${infoRes.status}`);
    process.exit(1);
  }
  const info = await infoRes.json();
  if (info?.email) return;

  console.log("Email not yet provisioned — requesting inbox...");
  const provRes = await fetch(`${POOL_URL}/api/proxy/email/provision`, {
    method: "POST",
    headers: { Authorization: `Bearer ${INSTANCE_ID}:${GATEWAY_TOKEN}`, "Content-Type": "application/json" },
  });
  if (!provRes.ok) {
    const err = await provRes.json().catch(() => ({}));
    console.error(`Email provisioning failed: ${err.error || provRes.status}`);
    process.exit(1);
  }
  const result = await provRes.json();
  console.log(`Email provisioned: ${result.email}`);
}

async function api(method, path, body) {
  let url;
  let headers;
  if (useProxy) {
    url = `${POOL_URL}${path}`;
    headers = {
      Authorization: `Bearer ${INSTANCE_ID}:${GATEWAY_TOKEN}`,
      "Content-Type": "application/json",
    };
  } else {
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

function inboxPath(suffix) {
  if (useProxy) {
    if (suffix === "messages/send") return "/api/proxy/email/send";
    return `/api/proxy/email/${suffix}`;
  }
  return `/inboxes/${inboxId}/${suffix}`;
}

function parseArgs(argv) {
  const map = {};
  const flags = [];
  for (let index = 0; index < argv.length; index++) {
    if (!argv[index].startsWith("--")) continue;
    const key = argv[index].slice(2);
    if (index + 1 < argv.length && !argv[index + 1].startsWith("--")) {
      map[key] = argv[++index];
    } else {
      flags.push(key);
    }
  }
  return { map, flags };
}

function fallbackEmailSend({ to, subject, text, html }) {
  recordLocalEmail({ to, subject, text, html });
  console.log("Sent to", to);
}

async function send(argv) {
  await requireEnv();
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
    const contentType = filename.endsWith(".ics") ? "text/calendar" : "application/octet-stream";
    payload.attachments = [
      { content: raw.toString("base64"), filename, content_type: contentType },
    ];
  }

  if (localServicesEnabled() && !useProxy) {
    fallbackEmailSend(payload);
    return;
  }

  await api("POST", inboxPath("messages/send"), payload);
  console.log("Sent to", to);
}

async function sendCalendar(argv) {
  await requireEnv();
  const { map } = parseArgs(argv);
  const to = map.to;
  const icsPath = map.ics;
  const subject = map.subject || "Calendar invite";

  if (!to || !icsPath) {
    console.error("Usage: services.mjs email send-calendar --to <email> --ics <path> [--subject <subj>]");
    process.exit(1);
  }

  if (localServicesEnabled() && !useProxy) {
    fallbackEmailSend({
      to,
      subject,
      text: "Calendar invite attached. Open the .ics file to add to your calendar.",
      html: "<p>Calendar invite attached. Open the .ics file to add to your calendar.</p>",
    });
    console.log("Sent calendar invite to", to);
    return;
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

async function getMessages(limit, labels, includeThreads) {
  if (localServicesEnabled() && !useProxy) {
    return {
      messages: listLocalEmails({ limit, labels }),
      threads: [],
    };
  }

  const params = new URLSearchParams({ limit: String(limit) });
  if (labels?.length) labels.forEach((label) => params.append("labels", label));

  const result = { messages: [], threads: [] };
  const messageData = await api("GET", `${inboxPath("messages")}?${params}`);
  result.messages = messageData?.messages ?? [];

  if (includeThreads) {
    const threadParams = new URLSearchParams();
    threadParams.append("labels", "unreplied");
    const threadData = await api("GET", `${inboxPath("threads")}?${threadParams}`);
    result.threads = threadData?.threads ?? [];
  }

  return result;
}

async function poll(argv) {
  await requireEnv();
  const { map, flags } = parseArgs(argv);
  const limit = parseInt(map.limit, 10) || 20;
  const labels = map.labels?.split(",").map((value) => value.trim()).filter(Boolean) || [];
  const includeThreads = flags.includes("threads");

  const out = await getMessages(limit, labels, includeThreads);

  if (flags.includes("json")) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  console.log(`Inbox ${useProxy ? "(proxy)" : localEmailAddress()}: ${out.messages.length} message(s)\n`);
  for (const message of out.messages) {
    const dir = message.labels?.includes("received") ? "received" : "sent";
    console.log(`  Subject: ${message.subject || "(none)"}`);
    console.log(`  From:    ${message.from}`);
    console.log(`  To:      ${[].concat(message.to || []).join(", ")}`);
    console.log(`  Date:    ${message.timestamp}`);
    console.log(`  Status:  ${dir}`);
    if (message.preview) console.log(`  Preview: ${message.preview.slice(0, 120)}`);
    console.log("");
  }
}

const EMAIL_CURSOR_FILE = "/tmp/.heartbeat-email-cursor";

function readCursor() {
  try {
    const ts = parseInt(readFileSync(EMAIL_CURSOR_FILE, "utf8").trim(), 10);
    return Number.isFinite(ts) ? ts : 0;
  } catch {
    return 0;
  }
}

function writeCursor(ts) {
  try { writeFileSync(EMAIL_CURSOR_FILE, String(ts), "utf8"); } catch {}
}

async function recent(argv) {
  await requireEnv();
  const { map, flags } = parseArgs(argv);
  const minutes = map.minutes ? parseInt(map.minutes, 10) : null;
  const sinceLast = flags.includes("since-last");
  const limit = parseInt(map.limit, 10) || 5;

  let cutoff;
  if (sinceLast) {
    cutoff = readCursor();
    if (cutoff === 0) cutoff = Date.now() - 30 * 60 * 1000;
  } else {
    cutoff = Date.now() - (minutes ?? 30) * 60 * 1000;
  }

  const messages = localServicesEnabled() && !useProxy
    ? listRecentLocalEmails({ cutoff, limit })
    : [];

  if (!(localServicesEnabled() && !useProxy)) {
    const params = new URLSearchParams({ limit: "20" });
    params.append("labels", "unread");
    const msgData = await api("GET", `${inboxPath("messages")}?${params}`);
    const all = msgData?.messages ?? [];
    messages.splice(0, messages.length, ...all.filter((message) => {
      const ts = message.timestamp ? new Date(message.timestamp).getTime() : 0;
      return ts > cutoff && message.labels?.includes("received");
    }).slice(0, limit));
  }

  if (sinceLast && messages.length > 0) {
    const newest = messages.reduce((max, message) => {
      const ts = message.timestamp ? new Date(message.timestamp).getTime() : 0;
      return ts > max ? ts : max;
    }, cutoff);
    writeCursor(newest);
  }

  if (messages.length === 0) {
    console.log("No new emails.");
    return;
  }

  for (const message of messages) {
    console.log(`From: ${message.from}`);
    console.log(`Subject: ${message.subject || "(none)"}`);
    console.log(`Date: ${message.timestamp}`);
    console.log(`Body: ${message.preview || message.body || "(no preview)"}`);
    console.log("");
  }
}

export default async function email(argv) {
  const [action, ...rest] = argv;

  switch (action) {
    case "send": return send(rest);
    case "send-calendar": return sendCalendar(rest);
    case "poll": return poll(rest);
    case "recent": return recent(rest);
    default:
      console.error("Usage: services.mjs email <send|send-calendar|poll|recent> [options]");
      process.exit(1);
  }
}
