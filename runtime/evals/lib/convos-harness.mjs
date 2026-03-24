// runtime/evals/lib/convos-harness.mjs
// Shared harness for e2e eval providers that interact with the agent via XMTP
// conversations (convos, poller, poller-hooks). Extracts the duplicated
// setup / messaging / transcript helpers into one place.

import { execFileSync, spawn } from 'child_process';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { resolveConvos, sleep, elapsed, log as _log } from './utils.mjs';
import { runtime } from './runtime.mjs';

const ENV = process.env.XMTP_ENV || 'dev';
const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Shared path resolution for Docker vs local.
// ---------------------------------------------------------------------------

export function resolveSkillsRoot() {
  return existsSync('/app/shared-workspace/skills')
    ? '/app/shared-workspace/skills'
    : resolve(__dirname, '../../shared/workspace/skills');
}

export function resolvePollerScript() {
  return existsSync('/app/shared-scripts/poller.sh')
    ? '/app/shared-scripts/poller.sh'
    : resolve(__dirname, '../../shared/scripts/poller.sh');
}

// ---------------------------------------------------------------------------
// Harness factory — each provider calls createHarness() once at module level.
//
// Options:
//   tag                — log prefix (e.g. 'convos', 'poller')
//   conversationPrefix — name prefix for the XMTP conversation
//   cleanup()          — extra teardown (e.g. kill poller process)
//   afterSetup({ sharedConversationId, EVAL_HOME, log }) — runs after join
// ---------------------------------------------------------------------------

export function createHarness(tag, opts = {}) {
  const GATEWAY_PORT =
    process.env.POOL_SERVER_PORT ||
    process.env.PORT ||
    process.env.GATEWAY_INTERNAL_PORT ||
    runtime.defaultPort;

  const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
  if (!GATEWAY_TOKEN) {
    console.error(`[eval:${tag}] OPENCLAW_GATEWAY_TOKEN is required. Set it in runtime/.env.`);
    process.exit(1);
  }

  const CONVOS = resolveConvos();
  const EVAL_HOME = mkdtempSync(join(tmpdir(), `eval-${tag}-`));
  const CONVOS_ENV = { ...process.env, HOME: EVAL_HOME };
  process.env.EVAL_CONVOS_HOME = EVAL_HOME;

  function log(msg) {
    _log(`eval:${tag}`, msg);
  }

  log(`Using identity store: ${EVAL_HOME}/.convos`);

  let sharedConversationId = null;
  let userInboxId = null;
  let testIndex = 0;

  // --- Cleanup -----------------------------------------------------------

  function cleanup() {
    try { if (opts.cleanup) opts.cleanup(); } catch {}
    try { rmSync(EVAL_HOME, { recursive: true, force: true }); } catch {}
  }
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });

  // --- Gateway -----------------------------------------------------------

  function checkGateway() {
    try {
      execFileSync('curl', ['-sf', `http://localhost:${GATEWAY_PORT}${runtime.healthPath}`], {
        encoding: 'utf-8',
        timeout: 5_000,
      });
      return true;
    } catch {
      return false;
    }
  }

  if (!checkGateway()) {
    console.error(`[eval:${tag}] Gateway not reachable at localhost:${GATEWAY_PORT}. Start it first.`);
    process.exit(1);
  }

  // --- Convos CLI wrapper ------------------------------------------------

  function convos(args, extraOpts = {}) {
    return execFileSync(CONVOS, args, {
      encoding: 'utf-8',
      timeout: 30_000,
      env: CONVOS_ENV,
      ...extraOpts,
    }).trim();
  }

  // --- Setup (create conversation + join agent) --------------------------

  function setup() {
    const t = Date.now();

    log('Resetting agent identity...');
    execFileSync('curl', [
      '-s', '-X', 'POST',
      `http://localhost:${GATEWAY_PORT}/convos/reset`,
      '-H', 'Content-Type: application/json',
      '-H', `Authorization: Bearer ${GATEWAY_TOKEN}`,
      '-d', '{}',
    ], { encoding: 'utf-8', timeout: 30_000 });

    log('Waiting for gateway to reinitialise...');
    const resetDeadline = Date.now() + 15_000;
    while (Date.now() < resetDeadline) {
      sleep(500);
      if (checkGateway()) break;
    }
    if (!checkGateway()) {
      console.error(`[eval:${tag}] Gateway failed to reinitialise after reset.`);
      process.exit(1);
    }

    log('Creating conversation...');
    const createOut = convos([
      'conversations', 'create',
      '--name', `${opts.conversationPrefix || 'QA Eval'} ${Date.now()}`,
      '--env', ENV, '--json',
    ]);
    const data = JSON.parse(createOut);
    if (!data.invite?.url) {
      throw new Error(`Missing invite URL in conversation create response: ${createOut}`);
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
      sleep(1_000);
      execFileSync('curl', [
        '-s', '-X', 'POST',
        `http://localhost:${GATEWAY_PORT}/convos/join`,
        '-H', 'Content-Type: application/json',
        '-H', `Authorization: Bearer ${GATEWAY_TOKEN}`,
        '-d', JSON.stringify({
          inviteUrl: data.invite.url,
          profileName: `${opts.conversationPrefix || 'QA Eval'} Agent`,
        }),
      ], { encoding: 'utf-8', timeout: 90_000 });
    } finally {
      try { watcher.kill(); } catch {}
    }

    // Wait for the agent's welcome message so the first test gets a clean
    // baseline. Without this, the welcome can arrive mid-test and be counted
    // as the response, shifting every subsequent result by one message.
    // This replaces the old fixed sleep(2_000) — it polls every 1.5s and
    // returns once the message arrives and stabilises (~3s), adapting to
    // actual network timing instead of hoping 2s is enough.
    log('Waiting for agent welcome message...');
    waitForAgent(0, 30_000);
    log(`Welcome drained (${agentCount(fetchMessages())} agent msgs)`);

    if (opts.afterSetup) opts.afterSetup({ sharedConversationId, EVAL_HOME, log });

    log(`Setup complete (${elapsed(t)})\n`);
  }

  // --- Messaging ---------------------------------------------------------

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
    // text and reply are both valid agent messages — reply is an XMTP quote.
    return typeId && typeId !== 'text' && typeId !== 'reply';
  }

  function isAgentReply(m) {
    return m.senderInboxId !== userInboxId && !isSystemMsg(m);
  }

  function agentCount(msgs) {
    return msgs.filter(isAgentReply).length;
  }

  function waitForAgent(baseline, timeoutMs = 60_000, settleMs = 3_000) {
    const deadline = Date.now() + timeoutMs;
    let msgs = [];
    try { msgs = fetchMessages(); } catch {}
    let count = agentCount(msgs);
    let lastChange = Date.now();
    log(`waitForAgent: baseline=${baseline} initial count=${count} total=${msgs.length}`);

    while (Date.now() < deadline) {
      sleep(1_500);
      try { msgs = fetchMessages(); } catch { continue; }
      const n = agentCount(msgs);
      if (n !== count) {
        log(`waitForAgent: agent count ${count} → ${n} (total=${msgs.length})`);
      }
      if (n > count) {
        count = n;
        lastChange = Date.now();
      } else if (count > baseline && Date.now() - lastChange >= settleMs) {
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
          return { msgs, text, matched: true };
        }
      } catch {}
    }
    log(`Content NOT matched within ${timeoutMs / 1000}s: ${pattern}`);
    const msgs = fetchMessages();
    return { msgs, text: transcript(msgs), matched: false };
  }

  function transcript(msgs, afterIndex = 0) {
    return msgs
      .slice(afterIndex)
      .filter((m) => {
        if (!m.contentType) return true;
        const typeId = typeof m.contentType === 'string' ? m.contentType : m.contentType.typeId;
        return typeId === 'text' || typeId === 'reply';
      })
      .map((m) => {
        const who = m.senderInboxId === userInboxId ? 'USER' : 'AGENT';
        return `[${who}] ${m.content || m.text || JSON.stringify(m)}`;
      })
      .join('\n');
  }

  // Wait a short window and confirm the agent stays quiet (no new messages).
  function waitForSilence(baseline, windowMs = 15_000) {
    const deadline = Date.now() + windowMs;
    while (Date.now() < deadline) {
      sleep(1_500);
      try {
        const msgs = fetchMessages();
        if (agentCount(msgs) > baseline) return { silent: false, msgs };
      } catch { continue; }
    }
    return { silent: true, msgs: fetchMessages() };
  }

  // --- Send + wait helper ------------------------------------------------

  function sendAndWait(prompt, meta = {}) {
    const existing = fetchMessages();
    const baseline = agentCount(existing);
    const msgsBefore = existing.length;

    if (meta.attachment) {
      // Attachment paths in suite YAML are relative to providers/ (e.g. "../fixtures/foo.png").
      // Resolve from the providers dir so paths work identically to the original providers.
      const providersDir = resolve(dirname(fileURLToPath(import.meta.url)), '../providers');
      const attachPath = meta.attachment.startsWith('/')
        ? meta.attachment
        : resolve(providersDir, meta.attachment);
      log(`Sending attachment: ${meta.attachment}`);
      convos(['conversation', 'send-attachment', sharedConversationId, attachPath, '--env', ENV], { timeout: 30_000 });
      sleep(1_000);
    }

    log(`Sending: "${prompt}"`);
    convos(['conversation', 'send-text', sharedConversationId, prompt, '--env', ENV], { timeout: 30_000 });

    const msgs = waitForAgent(baseline);
    const output = transcript(msgs, msgsBefore);

    const last = msgs.filter((m) => m.senderInboxId !== userInboxId).pop();
    const preview = last ? (last.content || last.text || '').slice(0, 120) : '(no response)';
    log(`Agent replied (${agentCount(msgs) - baseline} msg): ${preview}${preview.length >= 120 ? '...' : ''}`);

    return { output, msgs, baseline, msgsBefore };
  }

  // --- Public API --------------------------------------------------------

  return {
    get conversationId() { return sharedConversationId; },
    get userInboxId() { return userInboxId; },
    nextTest() { return ++testIndex; },
    get evalHome() { return EVAL_HOME; },
    get gatewayPort() { return GATEWAY_PORT; },
    get gatewayToken() { return GATEWAY_TOKEN; },
    log,
    convos,
    setup,
    ensureSetup() { if (!sharedConversationId) setup(); },
    fetchMessages,
    agentCount,
    waitForAgent,
    waitForContent,
    waitForSilence,
    transcript,
    sendAndWait,
    checkGateway,
  };
}
