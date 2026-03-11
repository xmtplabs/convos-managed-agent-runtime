// runtime/scripts/qa/eval/provider.mjs
// Custom Promptfoo provider for OpenClaw agent e2e eval.
// Creates a conversation, joins the runtime, sends messages via convos-cli,
// waits for the agent, then returns the full transcript for LLM-judge evaluation.

import { execSync, execFileSync, spawn } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resolveConvos } from './utils.mjs';

const SUITE_NAME = process.env.EVAL_SUITE_NAME || 'eval';
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

// State file lets sequential suites share the same conversation.
const STATE_FILE = join(tmpdir(), 'eval-state.json');

// Eval's convos-cli uses a separate HOME so it gets its own ~/.convos identity,
// distinct from the gateway's agent identity.
const EVAL_HOME = mkdtempSync(join(tmpdir(), 'eval-convos-'));
const CONVOS_ENV = { ...process.env, HOME: EVAL_HOME };
process.env.EVAL_CONVOS_HOME = EVAL_HOME;
console.log(`[${SUITE_NAME}] Using separate identity store: ${EVAL_HOME}/.convos`);

// Cleanup: the last suite to run cleans up everything.
// If state file exists and we're reusing, we're the last suite — clean up both.
// If we created the conversation but another suite follows, skip cleanup (it persists via state file).
const isResumingSuite = process.env.EVAL_SKIP_RESET === '1' && existsSync(STATE_FILE);
function cleanup() {
  try { rmSync(EVAL_HOME, { recursive: true, force: true }); } catch {}
  if (isResumingSuite) {
    // Clean up the original suite's eval home too
    try {
      const state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
      if (state.evalHome && state.evalHome !== EVAL_HOME) {
        rmSync(state.evalHome, { recursive: true, force: true });
      }
    } catch {}
    try { rmSync(STATE_FILE, { force: true }); } catch {}
  }
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
    console.error(`[${SUITE_NAME}] Gateway not reachable at localhost:${GATEWAY_PORT}. Start it first (pnpm gateway).`);
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
  const setupStart = Date.now();

  // If a previous suite already set up the conversation, reuse it
  if (process.env.EVAL_SKIP_RESET === '1' && existsSync(STATE_FILE)) {
    const state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    sharedConversationId = state.conversationId;
    userInboxId = state.userInboxId;
    // Restore the eval identity so convos-cli can read messages
    if (state.evalHome && existsSync(state.evalHome)) {
      Object.assign(CONVOS_ENV, { HOME: state.evalHome });
    }
    log(`Reusing conversation from core: ${sharedConversationId}`);
    log('');
    return;
  }

  if (process.env.EVAL_SKIP_RESET !== '1') {
    log('Resetting agent identity...');
    execFileSync('curl', [
      '-s', '-X', 'POST',
      `http://localhost:${GATEWAY_PORT}/convos/reset`,
      '-H', 'Content-Type: application/json',
      '-H', `Authorization: Bearer ${GATEWAY_TOKEN}`,
      '-d', '{}',
    ], { encoding: 'utf-8', timeout: 30_000 });
    log('Waiting for gateway to reinitialise (10s)...');
    execSync('sleep 10');
  }

  log('Creating conversation...');
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
  log(`Conversation created: ${sharedConversationId}`);

  log('Joining agent to conversation...');
  const processChild = spawn(CONVOS, [
    'conversations', 'process-join-requests',
    '--conversation', sharedConversationId,
    '--watch',
    '--env', ENV,
  ], { env: CONVOS_ENV, stdio: ['ignore', 'pipe', 'pipe'] });

  try {
    execSync('sleep 3');
    const joinBody = JSON.stringify({ inviteUrl, profileName: 'QA Eval Agent' });
    execFileSync('curl', [
      '-s', '-X', 'POST',
      `http://localhost:${GATEWAY_PORT}/convos/join`,
      '-H', 'Content-Type: application/json',
      '-H', `Authorization: Bearer ${GATEWAY_TOKEN}`,
      '-d', joinBody,
    ], { encoding: 'utf-8', timeout: 90_000 });
  } finally {
    try { processChild.kill(); } catch {}
  }

  // Persist state so the next suite can reuse this conversation
  writeFileSync(STATE_FILE, JSON.stringify({
    conversationId: sharedConversationId,
    userInboxId,
    evalHome: EVAL_HOME,
  }));

  execSync('sleep 5');
  const sec = ((Date.now() - setupStart) / 1000).toFixed(1);
  log(`Setup complete (${sec}s). Running tests...`);
  log('');
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

let testIndex = 0;

function log(msg) {
  console.log(`[${SUITE_NAME}] ${msg}`);
}

export default class OpenClawProvider {
  id() {
    return 'openclaw-agent';
  }

  async callApi(prompt, context) {
    testIndex++;
    const description = context.test?.description || `Test ${testIndex}`;
    const startTime = Date.now();

    log(`--- ${testIndex}. ${description} ---`);

    // Snapshot agent message count BEFORE the action that triggers a response.
    let baseline = 0;

    if (!sharedConversationId) {
      setup();
    }

    const vars = context.vars || {};

    // Self-destruct test: remove agent from group, verify gateway exits
    if (vars.selfDestruct) {
      log('Removing agent from group...');
      const result = handleSelfDestructTest();
      const ok = result.output === 'SELF_DESTRUCT_CONFIRMED';
      log(`${ok ? 'OK' : 'FAIL'} ${description} (${elapsed(startTime)})`);
      return result;
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
        log(`Sending attachment: ${vars.attachment}`);
        convos([
          'conversation', 'send-attachment', sharedConversationId,
          attachPath, '--env', ENV,
        ], { timeout: 30_000 });
        execSync('sleep 2');
      }

      // Send the text prompt
      log(`Sending: "${prompt}"`);
      convos([
        'conversation', 'send-text', sharedConversationId,
        prompt, '--env', ENV,
      ], { timeout: 30_000 });
    } else {
      log('Waiting for agent welcome message...');
    }

    // Wait for the agent to respond and settle, then build transcript
    log('Waiting for agent response...');
    const messages = waitForAgent(baseline);
    const agentMsgs = agentMessageCount(messages) - baseline;
    const transcript = buildTranscript(messages);

    // Fail fast: if the welcome test got zero real agent responses, abort the
    // entire eval — every subsequent test will fail too.
    if (vars.waitForWelcome && agentMessageCount(messages) === 0) {
      log('ABORT — agent never responded. Check gateway logs.');
      throw new Error(
        'Agent never sent a welcome message. The agent may not be running, ' +
        'or the LLM provider is returning errors. Check gateway logs. Aborting eval.'
      );
    }

    // Extract last agent message for a preview
    const lastAgent = messages.filter((m) => m.senderInboxId !== userInboxId).pop();
    const preview = lastAgent
      ? (lastAgent.content || lastAgent.text || '').slice(0, 120)
      : '(no response)';
    log(`Agent replied (${agentMsgs} msg, ${elapsed(startTime)}): ${preview}${preview.length >= 120 ? '...' : ''}`);

    return {
      output: transcript,
      metadata: { conversationId: sharedConversationId },
    };
  }
}

function elapsed(start) {
  const sec = ((Date.now() - start) / 1000).toFixed(1);
  return `${sec}s`;
}

function handleSelfDestructTest() {
  // Find the agent's inboxId from profiles
  log('Looking up agent profile...');
  const profilesOut = convos([
    'conversation', 'profiles', sharedConversationId, '--env', ENV, '--json',
  ], { timeout: 30_000 });
  const profilesData = JSON.parse(profilesOut);
  const profiles = profilesData.profiles || [];
  const agentProfile = profiles.find((p) => p.inboxId !== userInboxId);

  if (!agentProfile) {
    log('FAIL — could not find agent profile');
    return {
      output: 'SELF_DESTRUCT_FAILED: could not find agent profile',
      metadata: { conversationId: sharedConversationId, selfDestruct: true },
    };
  }

  // Remove the agent from the group
  log('Removing agent from group...');
  try {
    convos([
      'conversation', 'remove-members', sharedConversationId,
      agentProfile.inboxId, '--env', ENV,
    ], { timeout: 30_000 });
  } catch (err) {
    log(`FAIL — remove-members failed: ${err.message}`);
    return {
      output: `SELF_DESTRUCT_FAILED: remove-members failed: ${err.message}`,
      metadata: { conversationId: sharedConversationId, selfDestruct: true },
    };
  }

  // Poll /convos/status — after self-destruct the instance is nulled out
  log('Polling /convos/status for shutdown...');
  let selfDestructed = false;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    execSync('sleep 3');
    let statusOut;
    try {
      statusOut = execFileSync('curl', [
        '-sf',
        '-H', `Authorization: Bearer ${GATEWAY_TOKEN}`,
        `http://localhost:${GATEWAY_PORT}/convos/status`,
      ], { encoding: 'utf-8', timeout: 5_000 });
    } catch {
      // Gateway process exited entirely — counts as self-destruct
      selfDestructed = true;
      break;
    }

    let status;
    try {
      status = JSON.parse(statusOut);
    } catch {
      continue;
    }

    if (status.conversation === null && status.streaming === false) {
      selfDestructed = true;
      break;
    }
  }

  return {
    output: selfDestructed ? 'SELF_DESTRUCT_CONFIRMED' : 'SELF_DESTRUCT_FAILED: instance still active',
    metadata: { conversationId: sharedConversationId, selfDestruct: true },
  };
}
