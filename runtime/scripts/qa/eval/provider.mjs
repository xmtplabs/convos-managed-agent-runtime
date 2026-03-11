// runtime/scripts/qa/eval/provider.mjs
// Custom Promptfoo provider for OpenClaw agent e2e eval.
// Creates a conversation, joins the runtime, sends messages via convos-cli,
// waits for the agent, then returns the full transcript for LLM-judge evaluation.

import { execSync, execFileSync, spawn } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resolveConvos } from './utils.mjs';

const ENV = process.env.XMTP_ENV || 'dev';
// In CI the container runs pool-server on PORT (8080) which proxies to the gateway.
// Locally, `pnpm gateway` runs on GATEWAY_INTERNAL_PORT (18789) with no pool-server.
const GATEWAY_PORT = process.env.POOL_SERVER_PORT || process.env.PORT || process.env.GATEWAY_INTERNAL_PORT || '18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
if (!GATEWAY_TOKEN) {
  console.error('[eval] OPENCLAW_GATEWAY_TOKEN is required. Set it in runtime/.env.');
  process.exit(1);
}

const CONVOS = resolveConvos();

// Eval's convos-cli uses a separate HOME so it gets its own ~/.convos identity,
// distinct from the gateway's agent identity.
const EVAL_HOME = mkdtempSync(join(tmpdir(), 'eval-convos-'));
const CONVOS_ENV = { ...process.env, HOME: EVAL_HOME };
process.env.EVAL_CONVOS_HOME = EVAL_HOME;
console.log(`[eval] Using separate identity store: ${EVAL_HOME}/.convos`);

function cleanup() {
  try { rmSync(EVAL_HOME, { recursive: true, force: true }); } catch {}
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

function checkGateway() {
  try {
    execFileSync('curl', ['-sf', `http://localhost:${GATEWAY_PORT}/pool/health`],
      { encoding: 'utf-8', timeout: 5_000 }
    );
  } catch {
    console.error(`[eval] Gateway not reachable at localhost:${GATEWAY_PORT}. Start it first (pnpm gateway).`);
    process.exit(1);
  }
}

checkGateway();

let sharedConversationId = null;
let userInboxId = null;

function convos(args, opts = {}) {
  return execFileSync(CONVOS, args, { encoding: 'utf-8', timeout: 30_000, env: CONVOS_ENV, ...opts }).trim();
}

function setup() {
  console.log(`[eval] Resetting runtime convos identity...`);
  const resetOut = execFileSync('curl', [
    '-s', '-X', 'POST',
    `http://localhost:${GATEWAY_PORT}/convos/reset`,
    '-H', 'Content-Type: application/json',
    '-H', `Authorization: Bearer ${GATEWAY_TOKEN}`,
    '-d', '{}',
  ], { encoding: 'utf-8', timeout: 30_000 }).trim();
  console.log(`[eval] Reset response: ${resetOut}`);

  console.log(`[eval] Waiting for gateway to reinitialise...`);
  execSync('sleep 10');

  const createOut = convos([
    'conversations', 'create', '--name', `QA Eval ${Date.now()}`, '--env', ENV, '--json',
  ]);
  const data = JSON.parse(createOut);
  if (!data.invite?.url) {
    throw new Error(`Missing invite URL in conversation create response: ${createOut}`);
  }
  sharedConversationId = data.conversationId;
  userInboxId = data.inboxId;
  const inviteUrl = data.invite.url;

  console.log(`[eval] Created conversation ${sharedConversationId}`);
  console.log(`[eval] User inboxId: ${userInboxId}`);

  console.log(`[eval] Starting process-join-requests --watch in background...`);
  const processChild = spawn(CONVOS, [
    'conversations', 'process-join-requests',
    '--conversation', sharedConversationId,
    '--watch',
    '--env', ENV,
  ], { env: CONVOS_ENV, stdio: ['ignore', 'pipe', 'pipe'] });
  processChild.stdout.on('data', (d) => console.log(`[eval] process-join-requests: ${d.toString().trim()}`));
  processChild.stderr.on('data', (d) => console.log(`[eval] process-join-requests stderr: ${d.toString().trim()}`));

  try {
    execSync('sleep 3');

    const joinBody = JSON.stringify({ inviteUrl, profileName: 'QA Eval Agent' });
    console.log(`[eval] Calling /convos/join...`);
    const joinOut = execFileSync('curl', [
      '-s', '-X', 'POST',
      `http://localhost:${GATEWAY_PORT}/convos/join`,
      '-H', 'Content-Type: application/json',
      '-H', `Authorization: Bearer ${GATEWAY_TOKEN}`,
      '-d', joinBody,
    ], { encoding: 'utf-8', timeout: 90_000 }).trim();
    console.log(`[eval] Join response: ${joinOut}`);
  } finally {
    try { processChild.kill(); } catch {}
  }

  execSync('sleep 5');
}

function fetchMessages() {
  const out = convos([
    'conversation', 'messages', sharedConversationId,
    '--sync', '--limit', '50', '--direction', 'ascending', '--env', ENV, '--json',
  ], { timeout: 30_000 });
  const messages = JSON.parse(out);
  return Array.isArray(messages) ? messages : [];
}

function agentMessageCount(messages) {
  return messages.filter((m) => m.senderInboxId !== userInboxId).length;
}

// Wait for the agent to send at least one new message after `baseline`, then settle.
// Caller provides baseline (agent message count before the triggering action)
// so late responses already in the list are absorbed.
function waitForAgent(baseline) {
  const deadline = Date.now() + 120_000;
  const settleTime = 5_000;
  let messages = [];
  try { messages = fetchMessages(); } catch {}
  let currentCount = agentMessageCount(messages);
  let lastChangeAt = Date.now();

  while (Date.now() < deadline) {
    execSync('sleep 3');
    try { messages = fetchMessages(); } catch { continue; }
    const newCount = agentMessageCount(messages);
    if (newCount > currentCount) {
      currentCount = newCount;
      lastChangeAt = Date.now();
    } else if (currentCount > baseline && Date.now() - lastChangeAt >= settleTime) {
      return messages;
    }
  }
  return messages;
}

function buildTranscript(messages) {
  return messages.map((m) => {
    const sender = m.senderInboxId === userInboxId ? 'USER' : 'AGENT';
    const content = m.content || m.text || JSON.stringify(m);
    return `[${sender}] ${content}`;
  }).join('\n');
}

export default class OpenClawProvider {
  id() {
    return 'openclaw-agent';
  }

  async callApi(prompt, context) {
    // Snapshot agent message count BEFORE the action that triggers a response.
    // For the first call (welcome test), this is 0 (before setup/join).
    // For subsequent calls, it captures the count before we send the prompt.
    let baseline = 0;

    if (!sharedConversationId) {
      setup();
    }

    const vars = context.vars || {};

    // Self-destruct test: remove agent from group, verify gateway exits
    if (vars.selfDestruct) {
      return handleSelfDestructTest();
    }

    // For the welcome message test, just wait for the agent to send something
    if (!vars.waitForWelcome) {
      // Snapshot before sending — any agent messages already present are "old"
      try { baseline = agentMessageCount(fetchMessages()); } catch {}

      // Send attachment if present
      if (vars.attachment) {
        const attachDir = new URL('.', import.meta.url).pathname;
        const attachPath = vars.attachment.startsWith('./')
          ? `${attachDir}${vars.attachment.slice(2)}`
          : vars.attachment;
        convos([
          'conversation', 'send-attachment', sharedConversationId,
          attachPath, '--env', ENV,
        ], { timeout: 30_000 });
        console.log(`[eval] Sent attachment: ${vars.attachment}`);
        execSync('sleep 2');
      }

      // Send the text prompt
      convos([
        'conversation', 'send-text', sharedConversationId,
        prompt, '--env', ENV,
      ], { timeout: 30_000 });
      console.log(`[eval] Sent prompt: ${prompt}`);
    } else {
      // Welcome test: baseline is 0 (set above), so any agent message counts
      console.log(`[eval] Waiting for welcome message...`);
    }

    // Wait for the agent to respond and settle, then build transcript
    const messages = waitForAgent(baseline);
    const transcript = buildTranscript(messages);
    console.log(`[eval] Transcript length: ${transcript.length} chars`);
    return {
      output: transcript,
      metadata: { conversationId: sharedConversationId },
    };
  }
}

function handleSelfDestructTest() {
  console.log(`[eval] Self-destruct test: removing agent from group...`);

  // Find the agent's inboxId from profiles
  const profilesOut = convos([
    'conversation', 'profiles', sharedConversationId, '--env', ENV, '--json',
  ], { timeout: 30_000 });
  const profilesData = JSON.parse(profilesOut);
  const profiles = profilesData.profiles || [];
  const agentProfile = profiles.find((p) => p.inboxId !== userInboxId);

  if (!agentProfile) {
    return {
      output: 'SELF_DESTRUCT_FAILED: could not find agent profile',
      metadata: { conversationId: sharedConversationId, selfDestruct: true },
    };
  }

  console.log(`[eval] Agent inboxId: ${agentProfile.inboxId}`);

  // Remove the agent from the group
  try {
    convos([
      'conversation', 'remove-members', sharedConversationId,
      agentProfile.inboxId, '--env', ENV,
    ], { timeout: 30_000 });
    console.log(`[eval] Agent removed from group`);
  } catch (err) {
    return {
      output: `SELF_DESTRUCT_FAILED: remove-members failed: ${err.message}`,
      metadata: { conversationId: sharedConversationId, selfDestruct: true },
    };
  }

  // Wait for the agent to process the group_updated event and self-destruct.
  // Poll /convos/status — after self-destruct the instance is nulled out so
  // conversation will be null and streaming will be false.
  let selfDestructed = false;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    execSync('sleep 3');
    try {
      const statusOut = execFileSync('curl', [
        '-sf',
        '-H', `Authorization: Bearer ${GATEWAY_TOKEN}`,
        `http://localhost:${GATEWAY_PORT}/convos/status`,
      ], { encoding: 'utf-8', timeout: 5_000 });
      const status = JSON.parse(statusOut);
      console.log(`[eval] /convos/status:`, JSON.stringify(status));
      if (status.conversation === null && status.streaming === false) {
        selfDestructed = true;
        break;
      }
    } catch {
      // Gateway process exited entirely (pool-server mode) — also counts
      selfDestructed = true;
      break;
    }
  }

  const result = selfDestructed ? 'SELF_DESTRUCT_CONFIRMED' : 'SELF_DESTRUCT_FAILED: instance still active';
  console.log(`[eval] Self-destruct result: ${result}`);

  return {
    output: result,
    metadata: { conversationId: sharedConversationId, selfDestruct: true },
  };
}
