// runtime/evals/async.provider.mjs
// Provider that tests the agent delegates heavy tasks to sub-agents
// and stays responsive for follow-up queries.
//
// Flow:
//   1. Fire heavy task non-blocking (spawn) — like a second user message arriving
//   2. Probe gateway health while heavy task is processing
//   3. Send simple follow-up — should respond on a separate thread
//   4. Collect heavy task result (may be empty if still processing — that's fine)
//
// The test passes if:
//   - The heavy task gets a quick acknowledgment (or empty for hermes — 👀 was the ack)
//   - The simple query gets answered within threshold
//   - Gateway stays responsive

import { execFileSync, spawn } from 'child_process';
import http from 'http';
import { runtime } from '../lib/runtime.mjs';
import { elapsed, log as _log, clearSessionsOnce, cleanOutput, sleep } from '../lib/utils.mjs';

const GATEWAY_PORT = process.env.POOL_SERVER_PORT || process.env.PORT || process.env.GATEWAY_INTERNAL_PORT || runtime.defaultPort;
let testIndex = 0;

function log(msg) { _log('eval:async', msg); }

// Start the server if the runtime adapter provides a gateway (hermes).
if (runtime.gateway) {
  log('Starting server...');
  runtime.gateway.start(GATEWAY_PORT);
  const deadline = Date.now() + 30_000;
  let ready = false;
  while (Date.now() < deadline) {
    sleep(1_000);
    try {
      execFileSync('curl', ['-sf', `http://127.0.0.1:${GATEWAY_PORT}${runtime.healthPath}`],
        { encoding: 'utf-8', timeout: 5_000 });
      ready = true;
      break;
    } catch {}
  }
  if (!ready) {
    console.error(`[eval:async] Server failed to start on port ${GATEWAY_PORT} within 30s.`);
    runtime.gateway.stop();
    process.exit(1);
  }
  log('Server ready.');

  function cleanup() { try { runtime.gateway.stop(); } catch {} }
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });
}

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
    const raw = execFileSync(runtime.bin, runtime.args(prompt, sessionId), {
      encoding: 'utf-8', timeout: timeoutMs,
      ...(runtime.env ? { env: runtime.env } : {}),
      ...(runtime.cwd ? { cwd: runtime.cwd } : {}),
    }).trim();

    const output = cleanOutput(raw);
    return { output, durationMs: Date.now() - start, error: null };
  } catch (err) {
    return { output: '', durationMs: Date.now() - start, error: err.message };
  }
}

// Non-blocking version of runPrompt — fires the command and resolves when
// it finishes or the timeout expires. Returns whatever output was captured.
function runPromptAsync(prompt, sessionId, timeoutMs = 30_000) {
  return new Promise((resolve) => {
    const start = Date.now();
    let stdout = '';
    let settled = false;

    const proc = spawn(runtime.bin, runtime.args(prompt, sessionId), {
      ...(runtime.env ? { env: runtime.env } : {}),
      ...(runtime.cwd ? { cwd: runtime.cwd } : {}),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', () => {}); // drain stderr

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill();
        const output = cleanOutput(stdout.trim());
        resolve({ output, durationMs: Date.now() - start, error: null });
      }
    }, timeoutMs);

    proc.on('close', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        const output = cleanOutput(stdout.trim());
        resolve({ output, durationMs: Date.now() - start, error: null });
      }
    });

    proc.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ output: '', durationMs: Date.now() - start, error: err.message });
      }
    });
  });
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

    // 1. Fire heavy task non-blocking — like a second user message arriving
    const heavySession = `eval-async-heavy-${Date.now()}-${testIndex}`;
    log(`Sending heavy task (session: ${heavySession}): "${heavyPrompt.slice(0, 60)}..."`);
    const heavyPromise = runPromptAsync(heavyPrompt, heavySession, ackTimeoutMs);

    // 2. Probe gateway health (while heavy task is processing on thread A)
    let healthOk = false;
    try {
      const res = await httpGet(GATEWAY_PORT, runtime.healthPath, 5000);
      healthOk = res.status === 200;
      log(`Health probe: ${healthOk ? 'OK' : res.status} (${res.latencyMs}ms)`);
    } catch (err) {
      log(`Health probe FAILED: ${err.message}`);
    }

    // 3. Send follow-up in a DIFFERENT session (gets thread B — responds quickly)
    const followUpSession = `eval-async-followup-${Date.now()}-${testIndex}`;
    log(`Sending follow-up (session: ${followUpSession}): "${prompt}"`);
    const followUp = runPrompt(prompt, followUpSession, followUpTimeoutMs);

    if (followUp.error) {
      log(`Follow-up error (${followUp.durationMs}ms): ${followUp.error}`);
    } else {
      log(`Follow-up replied (${followUp.durationMs}ms): "${followUp.output.slice(0, 80)}"`);
    }

    // 4. Collect heavy task result (may still be running — that's fine)
    const heavy = await heavyPromise;

    if (heavy.error) {
      log(`Heavy task error (${heavy.durationMs}ms): ${heavy.error}`);
    } else {
      log(`Heavy task ack (${heavy.durationMs}ms): "${heavy.output.slice(0, 100)}"`);
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
