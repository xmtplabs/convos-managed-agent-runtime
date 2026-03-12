// runtime/evals/async.provider.mjs
// Provider that tests the agent delegates heavy tasks to sub-agents
// and stays responsive for follow-up queries.
//
// Flow:
//   1. Send a heavy task in a fresh session → agent should ack fast + spawn sub-agent
//   2. Immediately send a simple query in another fresh session → should respond fast
//   3. Probe gateway health throughout
//
// The test passes if:
//   - The heavy task gets a quick acknowledgment (not the full result)
//   - The simple query gets answered within threshold
//   - Gateway stays responsive

import { execFileSync } from 'child_process';
import http from 'http';
import { elapsed, log as _log, clearSessionsOnce } from './utils.mjs';

const ENTRY = process.env.OPENCLAW_ENTRY || 'openclaw';
const GATEWAY_PORT = process.env.POOL_SERVER_PORT || process.env.PORT || process.env.GATEWAY_INTERNAL_PORT || '18789';
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

function runPrompt(prompt, sessionId, timeoutMs = 30_000) {
  const start = Date.now();
  try {
    const raw = execFileSync(ENTRY, [
      'agent', '-m', prompt, '--agent', 'main', '--session-id', sessionId,
    ], { encoding: 'utf-8', timeout: timeoutMs }).trim();

    const output = raw.split('\n')
      .filter((l) => !l.match(/^\d{2}:\d{2}:\d{2} \[/))
      .join('\n')
      .replace(/\x1b\[[0-9;]*m/g, '')
      .trim();

    return { output, durationMs: Date.now() - start, error: null };
  } catch (err) {
    return { output: '', durationMs: Date.now() - start, error: err.message };
  }
}

export default class AsyncProvider {
  id() { return 'openclaw-async'; }

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

    // 1. Send heavy task in a fresh session — agent should delegate and ack fast
    const heavySession = `eval-async-heavy-${Date.now()}-${testIndex}`;
    log(`Sending heavy task (session: ${heavySession}): "${heavyPrompt.slice(0, 60)}..."`);
    const heavy = runPrompt(heavyPrompt, heavySession, ackTimeoutMs);

    if (heavy.error) {
      log(`Heavy task error (${heavy.durationMs}ms): ${heavy.error}`);
    } else {
      log(`Heavy task ack (${heavy.durationMs}ms): "${heavy.output.slice(0, 100)}"`);
    }

    // 2. Probe gateway health
    let healthOk = false;
    try {
      const res = await httpGet(GATEWAY_PORT, '/__openclaw__/canvas/', 5000);
      healthOk = res.status === 200;
      log(`Health probe: ${healthOk ? 'OK' : res.status} (${res.latencyMs}ms)`);
    } catch (err) {
      log(`Health probe FAILED: ${err.message}`);
    }

    // 3. Send simple follow-up in a DIFFERENT fresh session
    const followUpSession = `eval-async-followup-${Date.now()}-${testIndex}`;
    log(`Sending follow-up (session: ${followUpSession}): "${prompt}"`);
    const followUp = runPrompt(prompt, followUpSession, followUpTimeoutMs);

    if (followUp.error) {
      log(`Follow-up error (${followUp.durationMs}ms): ${followUp.error}`);
    } else {
      log(`Follow-up replied (${followUp.durationMs}ms): "${followUp.output.slice(0, 80)}"`);
    }

    // Build combined output for assertions
    // The primary output is the follow-up response (what the regex matches against)
    const output = followUp.output || followUp.error || '';

    return {
      output,
      metadata: {
        heavyAck: heavy.output,
        heavyDurationMs: heavy.durationMs,
        heavyError: heavy.error,
        followUpDurationMs: followUp.durationMs,
        followUpTimeout: followUpTimeoutMs,
        healthOk,
        delegated: !heavy.error && heavy.durationMs < ackTimeoutMs,
      },
    };
  }
}
