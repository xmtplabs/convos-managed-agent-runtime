// runtime/evals/convos.provider.mjs
// E2e eval provider for XMTP conversations.
// Creates a conversation, joins the runtime, sends messages via convos-cli,
// waits for the agent, then returns the transcript for assertion.

import { execFileSync } from 'child_process';
import { createHarness } from '../lib/convos-harness.mjs';
import { sleep, elapsed, log as _log } from '../lib/utils.mjs';
import { runtime } from '../lib/runtime.mjs';

const h = createHarness('convos', { conversationPrefix: 'QA Eval' });

function log(msg) { _log('eval', msg); }

export default class ConvosProvider {
  id() { return 'convos'; }

  async callApi(prompt, context) {
    const idx = h.nextTest();
    const desc = context.test?.description || `Test ${idx}`;
    const t = Date.now();
    log(`--- ${idx}. ${desc} ---`);

    h.ensureSetup();

    const meta = context.test?.metadata || {};

    if (meta.restart) {
      const result = handleRestart(h, prompt);
      log(`${result.metadata?.restarted ? 'OK' : 'FAIL'} ${desc} (${elapsed(t)})`);
      return result;
    }

    if (meta.selfDestruct) {
      const result = handleSelfDestruct(h);
      log(`${result.output === 'SELF_DESTRUCT_CONFIRMED' ? 'OK' : 'FAIL'} ${desc} (${elapsed(t)})`);
      return result;
    }

    if (meta.silence) {
      const existing = h.fetchMessages();
      const baseline = h.agentCount(existing);
      const msgsBefore = existing.length;
      log(`Sending: "${prompt}"`);
      h.convos(['conversation', 'send-text', h.conversationId, prompt, '--env', process.env.XMTP_ENV || 'dev'], { timeout: 30_000 });
      const { silent, msgs } = h.waitForSilence(baseline);
      const output = silent ? 'SILENCE_OK' : h.transcript(msgs, msgsBefore);
      log(`${silent ? 'OK (silent)' : 'FAIL (agent spoke)'} ${desc} (${elapsed(t)})`);
      return { output, metadata: { conversationId: h.conversationId } };
    }

    // Cron wait: wait for a setup reply, then collect messages over a window.
    // Returns the total agent message count received during the wait window
    // (excluding the initial setup reply) so assertions can verify delivery.
    if (meta.cronWait || meta.cronPing) {
      const existing = h.fetchMessages();
      const baseline = h.agentCount(existing);
      const msgsBefore = existing.length;
      log(`Sending: "${prompt}"`);
      h.convos(['conversation', 'send-text', h.conversationId, prompt, '--env', process.env.XMTP_ENV || 'dev'], { timeout: 30_000 });

      // First wait for the agent's confirmation reply
      const setupMsgs = h.waitForAgent(baseline);
      const setupCount = h.agentCount(setupMsgs);
      const setupReply = h.transcript(setupMsgs, msgsBefore);
      log(`Cron setup reply (${setupCount - baseline} msgs): ${setupReply.slice(0, 120)}`);

      // Now wait for cron-delivered messages
      const waitMs = (meta.cronWaitSeconds || 20) * 1000;
      log(`Waiting ${meta.cronWaitSeconds || 20}s for cron pings...`);
      const waitDeadline = Date.now() + waitMs;
      while (Date.now() < waitDeadline) {
        sleep(2_000);
      }
      const finalMsgs = h.fetchMessages();
      // Get all new agent messages after setup, then separate pings from noise
      const newAgentTexts = finalMsgs
        .filter(m => m.senderInboxId !== h.userInboxId)
        .slice(setupCount)
        .map(m => m.content || m.text || '')
        .filter(Boolean);
      // All new agent messages after setup count as cron-delivered. The agent
      // may respond with just "Ping!" or a longer explanation — both prove
      // the cron pipeline works.
      const cronPingTexts = newAgentTexts;
      const cronPings = cronPingTexts.length;
      log(`Cron delivered ${cronPings} messages in ${meta.cronWaitSeconds || 20}s: ${cronPingTexts.map(t => `"${t.slice(0, 80)}"`).join(', ') || '(none)'}`)

      // Cleanup: delete the cron job so pings don't interfere with later tests
      let cleanedUp = false;
      if (meta.cronCleanupPrompt) {
        const cleanupBaseline = h.agentCount(finalMsgs);
        log(`Sending cleanup: "${meta.cronCleanupPrompt}"`);
        h.convos(['conversation', 'send-text', h.conversationId, meta.cronCleanupPrompt, '--env', process.env.XMTP_ENV || 'dev'], { timeout: 30_000 });
        // Wait for deletion reply — pings may interleave so give extra time.
        const cleanupDeadline = Date.now() + 60_000;
        while (Date.now() < cleanupDeadline) {
          sleep(2_000);
          const msgs = h.fetchMessages();
          const newMsgs = msgs.filter(m => m.senderInboxId !== h.userInboxId).slice(cleanupBaseline);
          const hasDeleteConfirm = newMsgs.some(m => {
            const text = (m.content || m.text || '').toLowerCase();
            // Match deletion confirmations — agent may say "deleted", "done",
            // "stopped", or just confirm the action briefly.
            return /delet|remov|stop|kill|cancel|gone|done|got it|handled/.test(text) && text.length > 3;
          });
          if (hasDeleteConfirm) {
            cleanedUp = true;
            log('Cron job cleanup confirmed');
            break;
          }
        }
        if (!cleanedUp) log('Cron job cleanup not confirmed (pings may still fire)');
      }

      const output = h.transcript(h.fetchMessages(), msgsBefore);
      return {
        output,
        metadata: { conversationId: h.conversationId, cronPings, cronPingTexts, setupReply, cleanedUp },
      };
    }

    if (meta.waitForWelcome) {
      log('Waiting for agent welcome message...');
      const msgs = h.waitForAgent(0);
      if (h.agentCount(msgs) === 0) {
        log('ABORT — agent never responded. Check gateway logs.');
        throw new Error('Agent never sent a welcome message. Check gateway logs. Aborting eval.');
      }
      const output = h.transcript(msgs);
      return { output, metadata: { conversationId: h.conversationId } };
    }

    const { output } = h.sendAndWait(prompt, meta);
    log(`Done (${elapsed(t)})`);
    return { output, metadata: { conversationId: h.conversationId } };
  }
}

function handleRestart(h, prompt) {
  const ENV = process.env.XMTP_ENV || 'dev';

  // Each runtime exposes a restart endpoint: Hermes has /pool/restart (stops
  // adapter, re-resumes from credentials), OpenClaw has /pool/restart-gateway
  // (kills and respawns the gateway child). Both exercise the resume-from-
  // saved-credentials code path.
  const restartPath = runtime.restartPath;
  if (!restartPath) {
    h.log('FAIL — runtime adapter missing restartPath');
    return { output: 'RESTART_FAILED: no restartPath configured', metadata: { conversationId: h.conversationId, restarted: false } };
  }

  h.log(`Calling POST ${restartPath}...`);
  let restartOut;
  try {
    restartOut = execFileSync('curl', [
      '-s', '-o', '/dev/stdout', '-w', '\n%{http_code}',
      '-X', 'POST',
      '-H', 'Content-Type: application/json',
      '-H', `Authorization: Bearer ${h.gatewayToken}`,
      '-d', '{}',
      `http://localhost:${h.gatewayPort}${restartPath}`,
    ], { encoding: 'utf-8', timeout: 90_000 });
  } catch (err) {
    h.log(`FAIL — ${restartPath} not reachable: ${err.message}`);
    return { output: `RESTART_FAILED: ${err.message}`, metadata: { conversationId: h.conversationId, restarted: false } };
  }
  const lines = restartOut.trim().split('\n');
  const httpCode = lines.pop();
  const body = lines.join('\n');
  if (!httpCode.startsWith('2')) {
    h.log(`FAIL — ${restartPath} returned ${httpCode}: ${body}`);
    return { output: `RESTART_FAILED: HTTP ${httpCode}`, metadata: { conversationId: h.conversationId, restarted: false } };
  }
  h.log(`Restart response (${httpCode}): ${body.slice(0, 200)}`);

  // Wait a moment for the adapter to fully initialize
  sleep(5_000);

  const existing = h.fetchMessages();
  const baseline = h.agentCount(existing);
  const msgsBefore = existing.length;

  h.log(`Sending post-restart message: "${prompt}"`);
  h.convos(['conversation', 'send-text', h.conversationId, prompt, '--env', ENV], { timeout: 30_000 });
  const msgs = h.waitForAgent(baseline);
  const output = h.transcript(msgs, msgsBefore);

  const responded = h.agentCount(msgs) > baseline;
  h.log(responded ? 'Agent responded after restart' : 'FAIL — agent did not respond after restart');
  return { output, metadata: { conversationId: h.conversationId, restarted: responded } };
}

function handleSelfDestruct(h) {
  const ENV = process.env.XMTP_ENV || 'dev';

  h.log('Looking up agent profile...');
  const data = JSON.parse(h.convos([
    'conversation', 'profiles', h.conversationId, '--env', ENV, '--json',
  ], { timeout: 30_000 }));
  const profiles = data.profiles || [];
  const agent = profiles.find((p) => p.inboxId !== h.userInboxId);

  if (!agent) {
    h.log('FAIL — could not find agent profile');
    return { output: 'SELF_DESTRUCT_FAILED: no agent profile', metadata: { conversationId: h.conversationId } };
  }

  h.log('Removing agent from group...');
  try {
    h.convos(['conversation', 'remove-members', h.conversationId, agent.inboxId, '--env', ENV], { timeout: 30_000 });
  } catch (err) {
    h.log(`FAIL — remove-members: ${err.message}`);
    return { output: `SELF_DESTRUCT_FAILED: ${err.message}`, metadata: { conversationId: h.conversationId } };
  }

  h.log('Polling /convos/status for shutdown...');
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    sleep(1_000);
    try {
      const out = execFileSync('curl', [
        '-sf', '-H', `Authorization: Bearer ${h.gatewayToken}`,
        `http://localhost:${h.gatewayPort}/convos/status`,
      ], { encoding: 'utf-8', timeout: 5_000 });
      const s = JSON.parse(out);
      if (s.conversationId === null || s.conversationId === undefined) {
        return { output: 'SELF_DESTRUCT_CONFIRMED', metadata: { conversationId: h.conversationId } };
      }
    } catch {
      return { output: 'SELF_DESTRUCT_CONFIRMED', metadata: { conversationId: h.conversationId } };
    }
  }
  return { output: 'SELF_DESTRUCT_FAILED: instance still active', metadata: { conversationId: h.conversationId } };
}
