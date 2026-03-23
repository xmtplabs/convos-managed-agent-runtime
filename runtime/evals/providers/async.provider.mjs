// runtime/evals/async.provider.mjs
// Provider that tests the agent delegates heavy tasks to sub-agents
// and stays responsive for follow-up queries.
//
// Hermes (queryUrl) flow — concurrent:
//   1. Fire heavy task non-blocking (spawn) — like a second user message arriving
//   2. Probe server health while heavy task is processing
//   3. Send simple follow-up — should respond on a separate thread
//   4. Collect heavy task result (may be empty if still processing — that's fine)
//
// OpenClaw (CLI) flow — sequential:
//   1. Send heavy task (blocking) → agent should ack fast + spawn sub-agent
//   2. Probe gateway health
//   3. Send simple follow-up in a fresh session
//
// The test passes if:
//   - The heavy task gets a quick acknowledgment (or empty for hermes — 👀 was the ack)
//   - The simple query gets answered within threshold
//   - Gateway stays responsive

import http from 'http';
import { runtime } from '../lib/runtime.mjs';
import { elapsed, log as _log, clearSessionsOnce, queryAgent, queryAgentAsync } from '../lib/utils.mjs';

const HEALTH_PORT = process.env.PORT || runtime.defaultPort || '8080';
let testIndex = 0;

function log(msg) { _log('eval:async', msg); }

function httpGet(port, path, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const req = http.get({ hostname: '127.0.0.1', port, path }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, data, latencyMs: Date.now() - start }));
    });
    req.on('error', (err) => reject(err));
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('timeout')); });
  });
}

export default class AsyncProvider {
  id() { return 'async'; }

  async callApi(prompt, context) {
    clearSessionsOnce();
    testIndex++;
    const desc = context.test?.description || `Test ${testIndex}`;
    const meta = context.test?.metadata || {};
    const t = Date.now();
    log(`--- ${testIndex}. ${desc} ---`);

    const heavyPrompt = meta.heavyPrompt;
    const ackTimeoutMs = (meta.ackTimeout || 30) * 1000;
    const followUpTimeoutMs = (meta.followUpTimeout || 15) * 1000;

    if (!heavyPrompt) {
      return { output: '', error: 'metadata.heavyPrompt is required' };
    }

    const heavySession = `eval-async-heavy-${Date.now()}-${testIndex}`;
    log(`Sending heavy task (session: ${heavySession}): "${heavyPrompt.slice(0, 60)}..."`);

    let heavy, healthOk, followUp;

    // Health probe — shared between both flows
    async function probeHealth() {
      try {
        const res = await httpGet(HEALTH_PORT, runtime.healthPath, 5000);
        healthOk = res.status === 200;
        log(`Health probe: ${healthOk ? 'OK' : res.status} (${res.latencyMs}ms)`);
      } catch (err) {
        healthOk = false;
        log(`Health probe FAILED: ${err.message}`);
      }
    }

    function sendFollowUp() {
      const followUpSession = `eval-async-followup-${Date.now()}-${testIndex}`;
      log(`Sending follow-up (session: ${followUpSession}): "${prompt}"`);
      return queryAgent(prompt, followUpSession, { timeout: followUpTimeoutMs });
    }

    if (runtime.queryUrl) {
      // Hermes: fire heavy task non-blocking, probe health, send follow-up concurrently
      const heavyPromise = queryAgentAsync(heavyPrompt, heavySession, { timeout: ackTimeoutMs });
      await probeHealth();
      followUp = sendFollowUp();
      heavy = await heavyPromise;
    } else {
      // OpenClaw: sequential — heavy completes before follow-up to avoid
      // concurrent workspace-state.json writes in the gateway.
      heavy = queryAgent(heavyPrompt, heavySession, { timeout: ackTimeoutMs });
      await probeHealth();
      followUp = sendFollowUp();
    }

    if (heavy.error) {
      log(`Heavy task error (${heavy.durationMs}ms): ${heavy.error}`);
    } else {
      log(`Heavy task ack (${heavy.durationMs}ms): "${heavy.output.slice(0, 100)}"`);
    }

    if (followUp.error) {
      log(`Follow-up error (${followUp.durationMs}ms): ${followUp.error}`);
    } else {
      log(`Follow-up replied (${followUp.durationMs}ms): "${followUp.output.slice(0, 80)}"`);
    }

    // NEVER fall back to the error string — it contains URLs/ports that can
    // accidentally match time-like regexes (e.g. "127.0.0.1:8080" → "1:80").
    const output = followUp.output || '';

    return {
      output,
      error: followUp.error && !followUp.output ? followUp.error : undefined,
      metadata: {
        heavyAck: heavy.output,
        heavyDurationMs: heavy.durationMs,
        heavyError: heavy.error,
        followUpDurationMs: followUp.durationMs,
        followUpError: followUp.error,
        followUpTimeout: followUpTimeoutMs,
        healthOk,
        delegated: !heavy.error && heavy.durationMs < ackTimeoutMs,
      },
    };
  }
}
