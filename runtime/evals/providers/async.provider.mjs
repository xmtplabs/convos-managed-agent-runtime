// runtime/evals/async.provider.mjs
// Provider that tests the agent delegates heavy tasks to sub-agents
// and stays responsive for follow-up queries.
//
// Hermes (runtime.gateway) flow — concurrent:
//   1. Fire heavy task non-blocking (spawn) — like a second user message arriving
//   2. Probe gateway health while heavy task is processing
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

import { execFileSync, spawn } from 'child_process';
import http from 'http';
import { runtime } from '../lib/runtime.mjs';
import { elapsed, log as _log, clearSessionsOnce, cleanOutput, sleep } from '../lib/utils.mjs';

const GATEWAY_PORT = process.env.EVAL_GATEWAY_PORT || (runtime.gateway ? '9090' : runtime.defaultPort);
let testIndex = 0;

function log(msg) { _log('eval:async', msg); }

// When the runtime has a gateway (hermes), start the eval server and route
// queries through HTTP — exercising the production handle_message + run_in_executor path.
// Other runtimes (openclaw) use the adapter's CLI bin/args directly.
let queryBin = runtime.bin;
let queryArgs = runtime.args;

if (runtime.gateway) {
  const token = runtime.env?.OPENCLAW_GATEWAY_TOKEN || process.env.OPENCLAW_GATEWAY_TOKEN || '';
  queryBin = 'curl';
  queryArgs = (prompt, _session) => [
    '-sf',
    '-X', 'POST', `http://127.0.0.1:${GATEWAY_PORT}/agent/query`,
    '-H', 'Content-Type: application/json',
    '-H', `Authorization: Bearer ${token}`,
    '-d', JSON.stringify({ query: prompt }),
  ];

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
    const raw = execFileSync(queryBin, queryArgs(prompt, sessionId), {
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

    const proc = spawn(queryBin, queryArgs(prompt, sessionId), {
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

    const heavySession = `eval-async-heavy-${Date.now()}-${testIndex}`;
    log(`Sending heavy task (session: ${heavySession}): "${heavyPrompt.slice(0, 60)}..."`);

    let heavy, healthOk, followUp;

    if (runtime.gateway) {
      // Hermes: fire heavy task non-blocking, probe health, send follow-up concurrently
      const heavyPromise = runPromptAsync(heavyPrompt, heavySession, ackTimeoutMs);

      healthOk = false;
      try {
        const res = await httpGet(GATEWAY_PORT, runtime.healthPath, 5000);
        healthOk = res.status === 200;
        log(`Health probe: ${healthOk ? 'OK' : res.status} (${res.latencyMs}ms)`);
      } catch (err) {
        log(`Health probe FAILED: ${err.message}`);
      }

      const followUpSession = `eval-async-followup-${Date.now()}-${testIndex}`;
      log(`Sending follow-up (session: ${followUpSession}): "${prompt}"`);
      followUp = runPrompt(prompt, followUpSession, followUpTimeoutMs);

      heavy = await heavyPromise;
    } else {
      // OpenClaw: sequential — heavy completes before follow-up to avoid
      // concurrent workspace-state.json writes in the gateway.
      heavy = runPrompt(heavyPrompt, heavySession, ackTimeoutMs);

      healthOk = false;
      try {
        const res = await httpGet(GATEWAY_PORT, runtime.healthPath, 5000);
        healthOk = res.status === 200;
        log(`Health probe: ${healthOk ? 'OK' : res.status} (${res.latencyMs}ms)`);
      } catch (err) {
        log(`Health probe FAILED: ${err.message}`);
      }

      const followUpSession = `eval-async-followup-${Date.now()}-${testIndex}`;
      log(`Sending follow-up (session: ${followUpSession}): "${prompt}"`);
      followUp = runPrompt(prompt, followUpSession, followUpTimeoutMs);
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

    // Build combined output for assertions.
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
