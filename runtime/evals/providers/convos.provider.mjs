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
