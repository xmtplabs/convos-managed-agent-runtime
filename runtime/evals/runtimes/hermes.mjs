// Runtime adapter for Hermes.
// Hermes uses `hermes chat -q` for single-query mode.
// Each -q call auto-creates a fresh session (no --session-id flag).
// Quiet mode prints a `session_id:` footer that must be stripped.

import { readdirSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';

const hermesHome = process.env.HERMES_HOME || '/app/.hermes';
const memoriesDir = join(hermesHome, 'memories');
const sessionsDir = join(hermesHome, 'sessions');

function clearDir(dir) {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    try { unlinkSync(join(dir, f)); } catch {}
  }
}

export default {
  name: 'hermes',
  bin: 'hermes',
  args: (prompt, _session) => ['chat', '-q', prompt, '--quiet'],
  defaultPort: '8080',
  healthPath: '/pool/health',
  filterLines: (lines) => lines.filter((l) => !l.match(/^session_id:\s/)),
  needsSessionClear: false,
  convosPath: '../../hermes/node_modules/.bin/convos',
  memory: {
    extraArgs: [],
    reset() {
      clearDir(memoriesDir);
      clearDir(sessionsDir);
    },
    clearSessions() {
      clearDir(sessionsDir);
    },
    read() {
      if (!existsSync(memoriesDir)) return '';
      const files = readdirSync(memoriesDir).filter(f => f.endsWith('.md')).sort();
      return files.map(f => readFileSync(join(memoriesDir, f), 'utf-8')).join('\n\n');
    },
  },
};
