// runtime/evals/prompt.provider.mjs
// Lightweight provider that prompts the agent via the active runtime adapter.
// Clears session history on first call so the agent starts fresh.

import { execFileSync } from 'child_process';
import { runtime } from '../lib/runtime.mjs';
import { elapsed, log as _log, clearSessionsOnce, cleanOutput } from '../lib/utils.mjs';

let testIndex = 0;

function log(msg) { _log('eval:prompt', msg); }

export default class PromptProvider {
  id() { return 'openclaw-prompt'; }

  async callApi(prompt, context) {
    clearSessionsOnce();
    testIndex++;
    const desc = context.test?.description || `Test ${testIndex}`;
    const session = `eval-prompt-${Date.now()}-${testIndex}`;
    const t = Date.now();
    log(`--- ${testIndex}. ${desc} ---`);
    log(`Sending: "${prompt.slice(0, 80)}${prompt.length > 80 ? '...' : ''}"`);

    try {
      const raw = execFileSync(runtime.bin, runtime.args(prompt, session), {
        encoding: 'utf-8', timeout: 60_000,
        ...(runtime.env ? { env: runtime.env } : {}),
        ...(runtime.cwd ? { cwd: runtime.cwd } : {}),
      }).trim();

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
