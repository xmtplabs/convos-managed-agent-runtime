// runtime/evals/prompt.provider.mjs
// Lightweight provider that prompts the agent via the active runtime adapter.
//
// When the runtime has a gateway (hermes), starts a persistent eval server and
// routes queries via HTTP — the agent stays warm with cached context between tests.
// Otherwise falls back to one-shot CLI calls (openclaw).

import { execFileSync } from 'child_process';
import { runtime } from '../lib/runtime.mjs';
import { elapsed, log as _log, clearSessionsOnce, cleanOutput, sleep } from '../lib/utils.mjs';

let testIndex = 0;

function log(msg) { _log('eval:prompt', msg); }

const GATEWAY_PORT = process.env.EVAL_GATEWAY_PORT || '9091';
let useGateway = false;

if (runtime.gateway) {
  log('Starting persistent eval server for prompt tests...');
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
  if (ready) {
    useGateway = true;
    log(`Eval server ready on port ${GATEWAY_PORT}.`);
  } else {
    log('Eval server failed to start — falling back to CLI.');
    runtime.gateway.stop();
  }

  function cleanup() { try { runtime.gateway.stop(); } catch {} }
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });
}

export default class PromptProvider {
  id() { return 'openclaw-prompt'; }

  async callApi(prompt, context) {
    clearSessionsOnce();
    testIndex++;
    const desc = context.test?.description || `Test ${testIndex}`;
    const session = `eval-prompt-${testIndex}`;
    const t = Date.now();
    log(`--- ${testIndex}. ${desc} ---`);
    log(`Sending: "${prompt.slice(0, 80)}${prompt.length > 80 ? '...' : ''}"`);

    try {
      let raw;
      if (useGateway) {
        const token = runtime.env?.OPENCLAW_GATEWAY_TOKEN || process.env.OPENCLAW_GATEWAY_TOKEN || '';
        raw = execFileSync('curl', [
          '-sf',
          '-X', 'POST', `http://127.0.0.1:${GATEWAY_PORT}/agent/query`,
          '-H', 'Content-Type: application/json',
          '-H', `Authorization: Bearer ${token}`,
          '-d', JSON.stringify({ query: prompt, session }),
        ], { encoding: 'utf-8', timeout: 180_000 }).trim();
      } else {
        raw = execFileSync(runtime.bin, runtime.args(prompt, session), {
          encoding: 'utf-8', timeout: 180_000,
          ...(runtime.env ? { env: runtime.env } : {}),
          ...(runtime.cwd ? { cwd: runtime.cwd } : {}),
        }).trim();
      }

      const output = cleanOutput(raw);

      const preview = output.slice(0, 120);
      log(`Reply (${elapsed(t)}): ${preview}${output.length > 120 ? '...' : ''}`);
      return { output };
    } catch (err) {
      log(`Error (${elapsed(t)}): ${err.message}`);
      return { output: '', error: err.message };
    }
  }
}
