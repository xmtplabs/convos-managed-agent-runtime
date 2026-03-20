// runtime/evals/convos.provider.mjs
// E2e eval provider for XMTP conversations.
// Creates a conversation, joins the runtime, sends messages via convos-cli,
// waits for the agent, then returns the transcript for assertion.

import { execFileSync } from 'child_process';
import { createHarness } from '../lib/convos-harness.mjs';
import { sleep, elapsed, log as _log } from '../lib/utils.mjs';

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
      // Pings are short messages containing "ping" — filter out poller notifications etc.
      const cronPingTexts = newAgentTexts.filter(t => /ping/i.test(t) && t.length < 100);
      const cronPings = cronPingTexts.length;
      log(`Cron delivered ${cronPings} pings in ${meta.cronWaitSeconds || 20}s: ${cronPingTexts.map(t => `"${t.slice(0, 30)}"`).join(', ') || '(none)'}`)
      if (newAgentTexts.length > cronPings) {
        log(`  (${newAgentTexts.length - cronPings} non-ping agent messages also arrived)`);
      }

      // Cleanup: delete the cron job so pings don't interfere with later tests
      let cleanedUp = false;
      if (meta.cronCleanupPrompt) {
        const cleanupBaseline = h.agentCount(finalMsgs);
        log(`Sending cleanup: "${meta.cronCleanupPrompt}"`);
        h.convos(['conversation', 'send-text', h.conversationId, meta.cronCleanupPrompt, '--env', process.env.XMTP_ENV || 'dev'], { timeout: 30_000 });
        // Wait longer — pings may interleave, we need the actual deletion reply
        const cleanupDeadline = Date.now() + 30_000;
        while (Date.now() < cleanupDeadline) {
          sleep(2_000);
          const msgs = h.fetchMessages();
          const newMsgs = msgs.filter(m => m.senderInboxId !== h.userInboxId).slice(cleanupBaseline);
          const hasDeleteConfirm = newMsgs.some(m => {
            const text = (m.content || m.text || '').toLowerCase();
            // Match deletion confirmations — allow "ping" in the text since
            // "deleted the ping job" is a valid confirmation.
            return /delet|remov|stop|kill|cancel|gone/.test(text) && text.length > 5;
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
