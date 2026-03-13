// Runtime adapter for OpenClaw.

import { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const stateDir = process.env.OPENCLAW_STATE_DIR || join(homedir(), '.openclaw');
const workspaceDir = join(stateDir, 'workspace');
const sessionsDir = join(stateDir, 'agents', 'main', 'sessions');
const templateDir = resolve(__dirname, '../../openclaw/workspace');

function clearDir(dir) {
  try {
    for (const f of readdirSync(dir)) {
      try { unlinkSync(join(dir, f)); } catch {}
    }
  } catch {}
}

export default {
  name: 'openclaw',
  bin: process.env.OPENCLAW_ENTRY || 'openclaw',
  args: (prompt, session) => ['agent', '-m', prompt, '--agent', 'main', '--session-id', session],
  defaultPort: '18789',
  healthPath: '/__openclaw__/canvas/',
  filterLines: (lines) => lines,
  needsSessionClear: true,
  convosPath: '../../../node_modules/.bin/convos', // repo root node_modules (from evals/)
  memory: {
    extraArgs: ['--local'],
    reset() {
      if (!existsSync(workspaceDir)) mkdirSync(workspaceDir, { recursive: true });
      writeFileSync(join(workspaceDir, 'MEMORY.md'), readFileSync(join(templateDir, 'MEMORY.md'), 'utf-8'));
      writeFileSync(join(workspaceDir, 'USER.md'), readFileSync(join(templateDir, 'USER.md'), 'utf-8'));
      const dailyDir = join(workspaceDir, 'memory');
      if (existsSync(dailyDir)) {
        for (const f of readdirSync(dailyDir)) {
          if (f.endsWith('.md')) try { unlinkSync(join(dailyDir, f)); } catch {}
        }
      }
      clearDir(sessionsDir);
    },
    clearSessions() {
      clearDir(sessionsDir);
    },
    read() {
      try { return readFileSync(join(workspaceDir, 'MEMORY.md'), 'utf-8'); } catch { return ''; }
    },
  },
};
