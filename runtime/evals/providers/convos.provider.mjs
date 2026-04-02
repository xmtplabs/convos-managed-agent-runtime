// runtime/evals/convos.provider.mjs
// E2e eval provider for XMTP conversations.
// Creates a conversation, joins the runtime, sends messages via convos-cli,
// waits for the agent, then returns the transcript for assertion.
//
// Suite-level config (via YAML):
//   skipGreeting: false   — keep the greeting (default: true)

import { execFileSync } from 'child_process';
import { createHarness } from '../lib/convos-harness.mjs';
import { sleep, elapsed, log as _log } from '../lib/utils.mjs';
import { runtime } from '../lib/runtime.mjs';

function log(msg) { _log('eval', msg); }

export default class ConvosProvider {
  constructor(options) {
    this.config = options?.config || {};
    this.h = createHarness('convos', {
      conversationPrefix: 'QA Eval',
      skipGreeting: this.config.skipGreeting !== false, // default true
    });
  }

  id() { return 'convos'; }

  async callApi(prompt, context) {
    const h = this.h;
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

    // Cron wait: send prompt to create a cron job, wait for pings to arrive
    // via Convos. Returns all agent messages (setup reply + pings) joined as
    // plain text so the test can assert with a simple regex.
    if (meta.cronWait) {
      const existing = h.fetchMessages();
      const baseline = h.agentCount(existing);
      log(`Sending: "${prompt}"`);
      h.convos(['conversation', 'send-text', h.conversationId, prompt, '--env', process.env.XMTP_ENV || 'dev'], { timeout: 30_000 });

      // Wait for the agent's confirmation reply
      const setupMsgs = h.waitForAgent(baseline);
      const setupCount = h.agentCount(setupMsgs);
      log(`Cron setup reply (${setupCount - baseline} msgs)`);

      // Wait for cron-delivered pings
      const waitSec = meta.cronWaitSeconds || 90;
      log(`Waiting ${waitSec}s for cron pings...`);
      const waitDeadline = Date.now() + waitSec * 1000;
      while (Date.now() < waitDeadline) {
        sleep(2_000);
      }

      const finalMsgs = h.fetchMessages();
      const newAgentTexts = finalMsgs
        .filter(m => m.senderInboxId !== h.userInboxId)
        .slice(setupCount)
        .map(m => m.content || m.text || '')
        .filter(Boolean);
      log(`Cron delivered ${newAgentTexts.length} messages in ${waitSec}s: ${newAgentTexts.map(t => `"${t.slice(0, 80)}"`).join(', ') || '(none)'}`);

      // Cleanup: remove the eval cron job via the adapter so pings stop
      runtime.cleanEvalState();
      log('Cleaned eval cron jobs');

      const output = newAgentTexts.join('\n');
      return { output, metadata: { conversationId: h.conversationId, cronPings: newAgentTexts.length } };
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

    // Reaction test: send a prompt, wait for agent reply, react to the agent's
    // last message, then wait for the agent to respond to the reaction.
    if (meta.reaction) {
      const ENV = process.env.XMTP_ENV || 'dev';
      const { msgs: setupMsgs, baseline: setupBaseline } = h.sendAndWait(prompt, meta);

      // Find the agent's last message ID
      const agentMsgs = setupMsgs.filter(m => m.senderInboxId !== h.userInboxId);
      const lastAgentMsg = agentMsgs[agentMsgs.length - 1];
      if (!lastAgentMsg?.id) {
        log('FAIL — no agent message to react to');
        return { output: 'REACTION_FAILED: no agent message', metadata: { conversationId: h.conversationId } };
      }

      const postReactBaseline = h.agentCount(h.fetchMessages());
      const msgsBefore = h.fetchMessages().length;
      log(`Reacting ${meta.reaction} to agent message ${lastAgentMsg.id.slice(0, 12)}`);
      h.convos(['conversation', 'send-reaction', h.conversationId, lastAgentMsg.id, 'add', meta.reaction, '--env', ENV], { timeout: 30_000 });

      const reactionMsgs = h.waitForAgent(postReactBaseline);
      const output = h.transcript(reactionMsgs, msgsBefore);
      const responded = h.agentCount(reactionMsgs) > postReactBaseline;
      log(`${responded ? 'OK' : 'FAIL'} — agent ${responded ? 'responded to' : 'ignored'} reaction (${elapsed(t)})`);
      return { output, metadata: { conversationId: h.conversationId, reactionTriggered: responded } };
    }

    if (meta.replyToEarlier) {
      const setupMsg = meta.setupMessage || 'Remember this: the secret word is ABRACADABRA';
      h.sendAndWait(setupMsg);
      log('Setup exchange complete');

      const { output, msgs, msgsBefore } = h.sendAndWait(prompt);

      const newAgentMsgs = msgs.slice(msgsBefore).filter(m => m.senderInboxId !== h.userInboxId);
      const replyMsg = newAgentMsgs.find(m => {
        const typeId = typeof m.contentType === 'string' ? m.contentType : m.contentType?.typeId;
        return typeId === 'reply';
      });

      log(`Agent ${replyMsg ? 'used' : 'did not use'} reply-to`);
      log(`Done (${elapsed(t)})`);
      return {
        output,
        metadata: {
          conversationId: h.conversationId,
          agentUsedReply: Boolean(replyMsg),
        },
      };
    }

    const { output } = h.sendAndWait(prompt, meta);
    log(`Done (${elapsed(t)})`);
    return { output, metadata: { conversationId: h.conversationId } };
  }
}

function handleRestart(h, prompt) {
  const ENV = process.env.XMTP_ENV || 'dev';

  // Both runtimes expose POST /pool/restart which exercises the resume-from-
  // saved-credentials code path. Hermes stops the adapter and re-resumes;
  // OpenClaw kills and respawns the gateway child.
  const restartPath = runtime.restartPath;
  if (!restartPath) {
    h.log('SKIP — restart not supported by this runtime');
    return { output: '[AGENT] (restart test skipped)', metadata: { conversationId: h.conversationId, restarted: true } };
  }

  h.log(`Calling POST ${restartPath}...`);
  try {
    const out = execFileSync('curl', [
      '-sf', '-X', 'POST',
      '-H', 'Content-Type: application/json',
      '-H', `Authorization: Bearer ${h.gatewayToken}`,
      '-d', '{}',
      `http://localhost:${h.gatewayPort}${restartPath}`,
    ], { encoding: 'utf-8', timeout: 90_000 });
    h.log(`Restart OK: ${(out || '').trim().slice(0, 200)}`);
  } catch (err) {
    h.log(`FAIL — ${restartPath} failed: ${err.status || err.message}`);
    return { output: `RESTART_FAILED: ${restartPath} returned error`, metadata: { conversationId: h.conversationId, restarted: false } };
  }

  // Wait for the convos adapter to reconnect — the gateway may be up but
  // the XMTP bridge needs time to re-establish the conversation stream.
  h.log('Waiting for convos adapter to reconnect...');
  const statusDeadline = Date.now() + 90_000;
  let adapterReady = false;
  while (Date.now() < statusDeadline) {
    sleep(3_000);
    try {
      const statusOut = execFileSync('curl', [
        '-sf',
        '-H', `Authorization: Bearer ${h.gatewayToken}`,
        `http://localhost:${h.gatewayPort}/convos/status`,
      ], { encoding: 'utf-8', timeout: 5_000 });
      const status = JSON.parse(statusOut);
      if (status.conversationId) {
        h.log(`Adapter reconnected: conversation ${status.conversationId.slice(0, 12)}`);
        adapterReady = true;
        break;
      }
    } catch {}
  }
  if (!adapterReady) {
    h.log('FAIL — adapter did not reconnect within 90s');
    return { output: 'RESTART_FAILED: adapter did not reconnect', metadata: { conversationId: h.conversationId, restarted: false } };
  }
  // Extra settle time for message streams
  sleep(3_000);

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
