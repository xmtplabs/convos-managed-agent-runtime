// runtime/evals/onboarding.provider.mjs
// Thin wrapper around convos.provider that keeps the greeting enabled.
// Onboarding evals test the welcome message itself, so skipGreeting must be false.

import { createHarness } from '../lib/convos-harness.mjs';
import { elapsed, log as _log } from '../lib/utils.mjs';

const h = createHarness('convos', { conversationPrefix: 'QA Eval', skipGreeting: false });

function log(msg) { _log('eval', msg); }

export default class OnboardingProvider {
  id() { return 'onboarding'; }

  async callApi(prompt, context) {
    const idx = h.nextTest();
    const desc = context.test?.description || `Test ${idx}`;
    const t = Date.now();
    log(`--- ${idx}. ${desc} ---`);

    h.ensureSetup();

    const meta = context.test?.metadata || {};

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
