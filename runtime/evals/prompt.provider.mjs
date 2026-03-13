// runtime/evals/prompt.provider.mjs
// Lightweight provider that prompts the agent directly via `openclaw agent -m`.
// Clears session history on first call so the agent starts fresh.

import { execFileSync } from 'child_process';
import { elapsed, log as _log, clearSessionsOnce } from './utils.mjs';

const RUNTIME = process.env.EVAL_RUNTIME || 'openclaw';
const ENTRY = process.env.OPENCLAW_ENTRY || 'openclaw';
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
      const args = RUNTIME === 'hermes'
        ? ['chat', '-q', prompt, '--quiet']
        : ['agent', '-m', prompt, '--agent', 'main', '--session-id', session];
      const bin = RUNTIME === 'hermes' ? 'hermes' : ENTRY;
      const raw = execFileSync(bin, args, { encoding: 'utf-8', timeout: 60_000 }).trim();

      // Strip diagnostic/log lines that openclaw dumps to stdout,
      // ANSI escape codes that break regex assertions,
      // and the session_id footer that hermes prints in quiet mode
      const output = raw.split('\n')
        .filter((l) => !l.match(/^\d{2}:\d{2}:\d{2} \[/))
        .filter((l) => !l.match(/^session_id:\s/))
        .join('\n')
        .replace(/\x1b\[[0-9;]*m/g, '')
        .trim();

      const preview = output.slice(0, 120);
      log(`Reply (${elapsed(t)}): ${preview}${output.length > 120 ? '...' : ''}`);
      return { output };
    } catch (err) {
      log(`Error (${elapsed(t)}): ${err.message}`);
      return { output: '', error: err.message };
    }
  }
}
