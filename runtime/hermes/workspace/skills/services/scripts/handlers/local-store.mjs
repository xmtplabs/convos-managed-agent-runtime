#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";

function statePath() {
  return process.env.HERMES_EVAL_LOCAL_SERVICES_FILE
    || join(process.env.HERMES_HOME || tmpdir(), "local-services-state.json");
}

function blankState() {
  return {
    emails: { messages: [] },
    sms: { messages: [] },
  };
}

function loadState() {
  const path = statePath();
  if (!existsSync(path)) return blankState();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return {
      emails: { messages: parsed?.emails?.messages || [] },
      sms: { messages: parsed?.sms?.messages || [] },
    };
  } catch {
    return blankState();
  }
}

function saveState(state) {
  const path = statePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), "utf8");
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function previewText(text, html) {
  const source = text || html || "";
  return source.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function localServicesEnabled() {
  return process.env.HERMES_EVAL_LOCAL_SERVICES === "1";
}

export function localEmailAddress() {
  return process.env.AGENTMAIL_EMAIL || process.env.AGENTMAIL_INBOX_ID || "assistant@local.test";
}

export function localPhoneNumber() {
  return process.env.TELNYX_PHONE_NUMBER || "+15555550123";
}

export function recordLocalEmail({ to, subject, text, html }) {
  const state = loadState();
  const message = {
    id: makeId("email"),
    from: localEmailAddress(),
    to: [to],
    subject,
    preview: previewText(text, html).slice(0, 120),
    body: previewText(text, html),
    timestamp: new Date().toISOString(),
    labels: ["received", "unread"],
  };
  state.emails.messages.unshift(message);
  saveState(state);
  return message;
}

export function listLocalEmails({ limit = 20, labels = [] } = {}) {
  const state = loadState();
  const filtered = state.emails.messages.filter((message) =>
    labels.length === 0 || labels.every((label) => message.labels?.includes(label))
  );
  return filtered.slice(0, limit);
}

export function listRecentLocalEmails({ cutoff = 0, limit = 5 } = {}) {
  return listLocalEmails({ limit: 100 }).filter((message) => {
    const ts = message.timestamp ? new Date(message.timestamp).getTime() : 0;
    return ts > cutoff;
  }).slice(0, limit);
}

export function recordLocalSms({ to, text }) {
  const state = loadState();
  const message = {
    id: makeId("sms"),
    cli: localPhoneNumber(),
    sent_at: new Date().toISOString(),
    text,
    direction: "outbound",
    status: "queued",
    from: localPhoneNumber(),
    to: to,
  };
  state.sms.messages.unshift(message);
  saveState(state);
  return message;
}

export function listLocalSms({ limit = 10 } = {}) {
  const state = loadState();
  return state.sms.messages.slice(0, limit);
}

export function listRecentLocalSms({ cutoff = 0, limit = 5 } = {}) {
  return listLocalSms({ limit: 100 }).filter((message) => {
    const ts = message.sent_at ? new Date(message.sent_at).getTime() : 0;
    return ts > cutoff;
  }).slice(0, limit);
}

export function getLocalSms(id) {
  const state = loadState();
  return state.sms.messages.find((message) => message.id === id) || null;
}
