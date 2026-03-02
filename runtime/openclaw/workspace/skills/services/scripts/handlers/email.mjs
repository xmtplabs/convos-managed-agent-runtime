#!/usr/bin/env node
/**
 * Email handler — send, send-calendar, poll via AgentMail REST API.
 * Usage:
 *   node services.mjs email send --to <email> --subject <subj> --text <body> [--html <html>] [--attach <path>]
 *   node services.mjs email send-calendar --to <email> --ics <path> [--subject <subj>]
 *   node services.mjs email poll [--limit 20] [--labels unread] [--threads]
 */
import { readFileSync } from "fs";
import { resolve } from "path";

const API = "https://api.agentmail.to/v0";
const apiKey = process.env.AGENTMAIL_API_KEY;
const inboxId = process.env.AGENTMAIL_INBOX_ID;

function requireEnv() {
  if (!apiKey) { console.error("Email service not configured: missing API key"); process.exit(1); }
  if (!inboxId) { console.error("Email service not configured: missing inbox"); process.exit(1); }
}

async function api(method, path, body) {
  const opts = {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.message || data?.error || JSON.stringify(data);
    throw new Error(`AgentMail ${res.status}: ${msg}`);
  }
  return data;
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

  await api("POST", `/inboxes/${inboxId}/messages/send`, payload);
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

  await api("POST", `/inboxes/${inboxId}/messages/send`, {
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

  const msgData = await api("GET", `/inboxes/${inboxId}/messages?${params}`);
  out.messages = msgData?.messages ?? [];

  if (includeThreads) {
    const threadParams = new URLSearchParams();
    threadParams.append("labels", "unreplied");
    const threadData = await api("GET", `/inboxes/${inboxId}/threads?${threadParams}`);
    out.threads = threadData?.threads ?? [];
  }

  console.log(JSON.stringify(out, null, 2));
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
