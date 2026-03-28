// runtime/evals/webhook.provider.mjs
// E2E eval for the webhook notification pipeline:
//   simulate webhook POST to /convos/notify → agent receives and responds.

import { execFileSync } from 'child_process';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHarness } from '../lib/convos-harness.mjs';
import { elapsed } from '../lib/utils.mjs';
import { runtime } from '../lib/runtime.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const GATEWAY_PORT =
  process.env.POOL_SERVER_PORT ||
  process.env.PORT ||
  process.env.GATEWAY_INTERNAL_PORT ||
  runtime.defaultPort;

const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;

const h = createHarness('webhook', {
  conversationPrefix: 'Webhook Eval',
});

function sendNotify(text) {
  const res = execFileSync('curl', [
    '-s', '-w', '%{http_code}',
    '-X', 'POST',
    `http://localhost:${GATEWAY_PORT}/convos/notify`,
    '-H', 'Content-Type: application/json',
    '-H', `Authorization: Bearer ${GATEWAY_TOKEN}`,
    '-d', JSON.stringify({ text }),
  ], { encoding: 'utf-8', timeout: 30_000 });
  const code = res.slice(-3);
  if (code !== '200') {
    h.log(`WARNING: /convos/notify returned ${code}: ${res.slice(0, -3)}`);
  }
}

export default class WebhookProvider {
  id() { return 'webhook'; }

  async callApi(prompt, context) {
    const idx = h.nextTest();
    const desc = context.test?.description || `Test ${idx}`;
    const meta = context.test?.metadata || {};
    const t = Date.now();
    h.log(`--- ${idx}. ${desc} ---`);

    h.ensureSetup();

    if (meta.waitForNotification) {
      const preMsgs = h.fetchMessages();
      const welcomeEnd = preMsgs.length;
      const baseline = h.agentCount(preMsgs);

      // Send the appropriate notification via /convos/notify (simulates what the pool
      // webhook handler does when AgentMail or Telnyx pushes an event).
      if (meta.notificationType === 'sms') {
        const smsPayload = 'You got a new text. "Hey, are you available for a call tomorrow?" from +15551234567';
        h.log(`[TESTING] SMS webhook → /convos/notify: "${smsPayload}"`);
        sendNotify(smsPayload);
      } else {
        const emailPayload = '[System: new email] From: QA Bot <qa@example.com> | Subject: Webhook eval test — Read the full email with: email read --id eval-test-001';
        h.log(`[TESTING] Email webhook → /convos/notify: "${emailPayload}"`);
        sendNotify(emailPayload);
      }

      // Wait for agent to respond to the notification
      const { matched } = h.waitForContent(
        meta.notificationType === 'sms' ? /text|sms|message.*from/i : /email|mail|inbox/i,
        60_000,
      );

      if (matched) {
        h.log('Agent responded to notification — waiting to settle...');
        h.waitForAgent(baseline, 30_000, 5_000);
      } else {
        h.log('No proactive response — nudging agent...');
        if (meta.notificationType === 'sms') {
          h.sendAndWait('Did any texts come in?', {});
        } else {
          h.sendAndWait('Did any emails or notifications come in?', {});
        }
      }

      const finalMsgs = h.fetchMessages();
      const text = h.transcript(finalMsgs, welcomeEnd);
      h.log(`Transcript (post-welcome):\n${text || '(empty)'}`);
      h.log(`Notification test done (${elapsed(t)})`);
      return { output: text, metadata: { conversationId: h.conversationId } };
    }

    // Non-notification tests: send prompt and wait
    const { output } = h.sendAndWait(prompt, meta);
    h.log(`Done (${elapsed(t)})`);
    return { output, metadata: { conversationId: h.conversationId } };
  }
}
