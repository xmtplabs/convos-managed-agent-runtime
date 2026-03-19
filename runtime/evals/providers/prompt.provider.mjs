// runtime/evals/prompt.provider.mjs
// Lightweight provider that prompts the agent via the active runtime adapter.
//
// Hermes: curls the production server's /agent/query endpoint (always running).
// OpenClaw: one-shot CLI calls via the adapter's bin/args.

import { execFileSync } from 'child_process';
import { runtime } from '../lib/runtime.mjs';
import { elapsed, log as _log, clearSessionsOnce, cleanOutput } from '../lib/utils.mjs';

let testIndex = 0;

function log(msg) { _log('eval:prompt', msg); }

const queryUrl = runtime.queryUrl || null;
const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN || '';

export default class PromptProvider {
  id() { return 'prompt'; }

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
      if (queryUrl) {
        raw = execFileSync('curl', [
          '-sf',
          '-X', 'POST', `${queryUrl}/agent/query`,
          '-H', 'Content-Type: application/json',
          '-H', `Authorization: Bearer ${gatewayToken}`,
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
