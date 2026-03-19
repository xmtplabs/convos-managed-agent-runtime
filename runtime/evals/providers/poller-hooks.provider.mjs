// runtime/evals/poller-hooks.provider.mjs
// E2E eval for poller hook auto-discovery:
//   plants a fake skill with poll.sh → poller picks it up → notification in XMTP.
// Also tests that the agent knows to create polling skills (not modify HEARTBEAT.md).
// OpenClaw only.

import { execSync, execFileSync, spawn } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { resolveConvos, sleep, elapsed, log as _log } from '../lib/utils.mjs';
import { runtime } from '../lib/runtime.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ENV = process.env.XMTP_ENV || 'dev';
const GATEWAY_PORT = process.env.POOL_SERVER_PORT || process.env.PORT || process.env.GATEWAY_INTERNAL_PORT || runtime.defaultPort;
let GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
if (!GATEWAY_TOKEN) {
  console.error('[eval:poller-hooks] OPENCLAW_GATEWAY_TOKEN is required. Set it in runtime/.env.');
  process.exit(1);
}

const CONVOS = resolveConvos();

const EVAL_HOME = mkdtempSync(join(tmpdir(), 'eval-poller-hooks-'));
const CONVOS_ENV = { ...process.env, HOME: EVAL_HOME };
process.env.EVAL_CONVOS_HOME = EVAL_HOME;
log(`Using identity store: ${EVAL_HOME}/.convos`);

// Resolve skills root — use a temp copy so we can plant a test skill without
// touching the real workspace.
const REAL_SKILLS_ROOT = existsSync('/app/shared-workspace/skills')
  ? '/app/shared-workspace/skills'
  : resolve(__dirname, '../../shared/workspace/skills');
const SKILLS_ROOT = join(EVAL_HOME, 'skills');

const POLLER_SCRIPT = existsSync('/app/shared-scripts/poller.sh')
  ? '/app/shared-scripts/poller.sh'
  : resolve(__dirname, '../../shared/scripts/poller.sh');

let pollerProc = null;

function cleanup() {
  if (pollerProc) { try { pollerProc.kill('SIGKILL'); } catch {} pollerProc = null; }
  try { rmSync(EVAL_HOME, { recursive: true, force: true }); } catch {}
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

function checkGateway() {
  try {
    execFileSync('curl', ['-sf', `http://localhost:${GATEWAY_PORT}${runtime.healthPath}`],
      { encoding: 'utf-8', timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

function log(msg) { _log('eval:poller-hooks', msg); }

function convos(args, opts = {}) {
  return execFileSync(CONVOS, args, { encoding: 'utf-8', timeout: 30_000, env: CONVOS_ENV, ...opts }).trim();
}

if (!checkGateway()) {
  console.error(`[eval:poller-hooks] Gateway not reachable at localhost:${GATEWAY_PORT}. Start it first.`);
  process.exit(1);
}

let sharedConversationId = null;
let userInboxId = null;
let testIndex = 0;

function setup() {
  const t = Date.now();

  // Copy real skills into temp dir so we can add a test skill
  log('Copying skills to temp dir...');
  execSync(`cp -R "${REAL_SKILLS_ROOT}" "${SKILLS_ROOT}"`, { encoding: 'utf-8' });

  // Plant the test skill with a poll.sh that emits a notification
  log('Planting test skill with poll.sh...');
  const testSkillDir = join(SKILLS_ROOT, 'eval-rss-tracker');
  mkdirSync(testSkillDir, { recursive: true });
  writeFileSync(join(testSkillDir, 'SKILL.md'), [
    '---',
    'name: eval-rss-tracker',
    'description: |',
    '  Test skill for poller hooks eval. Emits a fake RSS notification.',
    '---',
    '',
    '# Eval RSS Tracker',
    '',
    'Test skill — poll.sh prints a fake notification each cycle.',
  ].join('\n'));
  // poll.sh prints once (uses a flag file to avoid repeating every cycle)
  writeFileSync(join(testSkillDir, 'poll.sh'), [
    '#!/bin/sh',
    'FLAG="/tmp/.eval-rss-tracker-fired"',
    'if [ ! -f "$FLAG" ]; then',
    '  echo "New post on Eval Feed: \\"Testing poller hooks\\" by eval-bot"',
    '  touch "$FLAG"',
    'fi',
  ].join('\n'));

  log('Resetting agent identity...');
  execFileSync('curl', [
    '-s', '-X', 'POST',
    `http://localhost:${GATEWAY_PORT}/convos/reset`,
    '-H', 'Content-Type: application/json',
    '-H', `Authorization: Bearer ${GATEWAY_TOKEN}`,
    '-d', '{}',
  ], { encoding: 'utf-8', timeout: 30_000 });
  log('Waiting for gateway to reinitialise (10s)...');
  sleep(10_000);

  log('Creating conversation...');
  const createOut = convos([
    'conversations', 'create', '--name', `Poller Hooks Eval ${Date.now()}`, '--env', ENV, '--json',
  ]);
  const data = JSON.parse(createOut);
  if (!data.invite?.url || !data.conversationId || !data.inboxId) {
    throw new Error(`Missing invite URL, conversationId, or inboxId in conversation create response: ${createOut}`);
  }
  sharedConversationId = data.conversationId;
  userInboxId = data.inboxId;
  log(`Conversation created: ${sharedConversationId}`);

  log('Joining agent to conversation...');
  const watcher = spawn(CONVOS, [
    'conversations', 'process-join-requests',
    '--conversation', sharedConversationId,
    '--watch', '--env', ENV,
  ], { env: CONVOS_ENV, stdio: ['ignore', 'pipe', 'pipe'] });

  try {
    sleep(3_000);
    execFileSync('curl', [
      '-s', '-X', 'POST',
      `http://localhost:${GATEWAY_PORT}/convos/join`,
      '-H', 'Content-Type: application/json',
      '-H', `Authorization: Bearer ${GATEWAY_TOKEN}`,
      '-d', JSON.stringify({ inviteUrl: data.invite.url, profileName: 'Poller Hooks Eval Agent' }),
    ], { encoding: 'utf-8', timeout: 90_000 });
  } finally {
    try { watcher.kill(); } catch {}
  }

  sleep(5_000);

  // Clean up the flag file from any previous run
  try { rmSync('/tmp/.eval-rss-tracker-fired', { force: true }); } catch {}

  // Start the poller with our temp skills root
  log('Starting poller with test skills...');
  pollerProc = spawn('sh', [POLLER_SCRIPT], {
    env: {
      ...process.env,
      HOME: EVAL_HOME,
      CONVOS_CONVERSATION_ID: sharedConversationId,
      CONVOS_ENV: ENV,
      POLL_INTERVAL_SECONDS: '10',
      SKILLS_ROOT,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  pollerProc.stdout.on('data', (d) => { process.stdout.write(d); });
  pollerProc.stderr.on('data', (d) => { process.stderr.write(d); });

  // Wait for poller 15s startup delay + buffer
  log('Waiting 18s for poller startup...');
  sleep(18_000);

  log(`Setup complete (${elapsed(t)})\n`);
}

function fetchMessages() {
  const out = convos([
    'conversation', 'messages', sharedConversationId,
    '--sync', '--limit', '50', '--direction', 'ascending', '--env', ENV, '--json',
  ], { timeout: 30_000 });
  const msgs = JSON.parse(out);
  return Array.isArray(msgs) ? msgs : [];
}

function isSystemMsg(m) {
  if (!m.contentType) return false;
  const typeId = typeof m.contentType === 'string' ? m.contentType : m.contentType.typeId;
  return typeId && typeId !== 'text';
}

function isAgentReply(m) {
  return m.senderInboxId !== userInboxId && !isSystemMsg(m);
}

function agentCount(msgs) {
  return msgs.filter(isAgentReply).length;
}

function waitForAgent(baseline) {
  const deadline = Date.now() + 120_000;
  let msgs = [];
  try { msgs = fetchMessages(); } catch {}
  let count = agentCount(msgs);
  let lastChange = Date.now();
  log(`waitForAgent: baseline=${baseline} initial count=${count} total=${msgs.length}`);

  while (Date.now() < deadline) {
    sleep(3_000);
    try { msgs = fetchMessages(); } catch { continue; }
    const n = agentCount(msgs);
    if (n !== count) {
      log(`waitForAgent: agent count ${count} → ${n} (total=${msgs.length})`);
    }
    if (n > count) {
      count = n;
      lastChange = Date.now();
    } else if (count > baseline && Date.now() - lastChange >= 5_000) {
      log(`waitForAgent: stable at count=${count} — done`);
      return msgs;
    }
  }
  log(`waitForAgent: timed out — final count=${count} baseline=${baseline}`);
  return msgs;
}

function waitForContent(pattern, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    sleep(5_000);
    try {
      const msgs = fetchMessages();
      const text = transcript(msgs);
      if (pattern.test(text)) {
        log(`Content matched: ${pattern}`);
        return { msgs, text };
      }
    } catch {}
  }
  log(`Content NOT matched within ${timeoutMs / 1000}s: ${pattern}`);
  const msgs = fetchMessages();
  return { msgs, text: transcript(msgs) };
}

function transcript(msgs, afterIndex = 0) {
  return msgs.slice(afterIndex)
    .filter((m) => {
      if (!m.contentType) return true;
      const typeId = typeof m.contentType === 'string' ? m.contentType : m.contentType.typeId;
      return typeId === 'text';
    })
    .map((m) => {
      const who = m.senderInboxId === userInboxId ? 'USER' : 'AGENT';
      return `[${who}] ${m.content || m.text || JSON.stringify(m)}`;
    }).join('\n');
}

export default class PollerHooksProvider {
  id() { return 'poller-hooks'; }

  async callApi(prompt, context) {
    testIndex++;
    const desc = context.test?.description || `Test ${testIndex}`;
    const meta = context.test?.metadata || {};
    const t = Date.now();
    log(`--- ${testIndex}. ${desc} ---`);

    if (!sharedConversationId) setup();

    // Test 1: Wait for the custom poll.sh notification to appear
    if (meta.waitForNotification) {
      const { msgs: notifMsgs } = waitForContent(/New post on Eval Feed/i, 120_000);
      const text = transcript(notifMsgs);
      log(`Transcript:\n${text}`);
      log(`Hook discovery test done (${elapsed(t)})`);
      return { output: text, metadata: { conversationId: sharedConversationId } };
    }

    // Test 2+: Send prompt and wait for agent reply
    const existing = fetchMessages();
    const baseline = agentCount(existing);
    const msgsBefore = existing.length;
    log(`Pre-send state — agent count=${baseline} total=${msgsBefore}`);

    log(`Sending: "${prompt}"`);
    convos(['conversation', 'send-text', sharedConversationId, prompt, '--env', ENV], { timeout: 30_000 });
    log(`Message sent — waiting for agent reply (baseline=${baseline})...`);

    const msgs = waitForAgent(baseline);
    const output = transcript(msgs, msgsBefore);
    log(`Output transcript:\n${output || '(empty)'}`);

    const last = msgs.filter((m) => m.senderInboxId !== userInboxId).pop();
    const preview = last ? (last.content || last.text || '').slice(0, 120) : '(no response)';
    log(`Agent replied (${elapsed(t)}): ${preview}${preview.length >= 120 ? '...' : ''}`);

    return { output, metadata: { conversationId: sharedConversationId } };
  }
}
