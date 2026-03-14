// Runtime adapter for Hermes.
//
// Both local and CI use the same code path: python3 -m src.agent_runner.
//
// Local: buildEvalEnv() sources eval-env.sh to set HERMES_HOME, PYTHONPATH,
//   copy workspace files, and set cwd to $HOME (where AGENTS.md lives).
// Docker (CI): The Dockerfile already sets all of this. buildEvalEnv()
//   detects Docker (no eval-env.sh) and returns process.env unchanged.

import { readdirSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const hermesDir = join(__dirname, '../../hermes');
const evalHome = join(hermesDir, '.eval-home');
const evalEnvScript = join(hermesDir, 'scripts', 'eval-env.sh');

// Build the eval environment by sourcing eval-env.sh.
// In Docker, eval-env.sh doesn't exist — the Dockerfile already set everything up.
let _cachedEnv = null;
function buildEvalEnv() {
  if (_cachedEnv) return _cachedEnv;

  if (!existsSync(evalEnvScript)) {
    // Docker / CI — environment is already set by Dockerfile
    _cachedEnv = { env: { ...process.env }, cwd: process.cwd() };
    return _cachedEnv;
  }

  // Local — source eval-env.sh to replicate the Dockerfile setup
  const script = `. "${evalEnvScript}" && env`;
  const envOut = execSync(script, {
    encoding: 'utf-8',
    shell: '/bin/sh',
    cwd: hermesDir,
    env: { ...process.env, HOME: evalHome },
  });
  const env = {};
  for (const line of envOut.split('\n')) {
    const idx = line.indexOf('=');
    if (idx > 0) env[line.slice(0, idx)] = line.slice(idx + 1);
  }
  // PYTHONPATH must include hermes-agent and the runtime dir
  env.PYTHONPATH = `${join(hermesDir, '.hermes-dev', 'hermes-agent')}:${hermesDir}${env.PYTHONPATH ? ':' + env.PYTHONPATH : ''}`;
  env.NODE_PATH = join(hermesDir, 'node_modules');
  env.PATH = `${join(hermesDir, 'node_modules', '.bin')}:${env.PATH || ''}`;
  if (!env.OPENCLAW_GATEWAY_TOKEN) {
    env.OPENCLAW_GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || Math.random().toString(36).slice(2);
  }

  // cwd = $HOME so Hermes finds AGENTS.md via cwd discovery
  // (mirrors Docker where WORKDIR=/app and AGENTS.md is at /app/AGENTS.md)
  const cwd = env.HOME || evalHome;
  _cachedEnv = { env, cwd };
  return _cachedEnv;
}

const { env: evalEnv, cwd: evalCwd } = buildEvalEnv();
const hermesHome = evalEnv.HERMES_HOME || join(evalHome, '.hermes');
const memoriesDir = join(hermesHome, 'memories');
const sessionsDir = join(hermesHome, 'sessions');
const stateDb = join(hermesHome, 'state.db');

function clearDir(dir) {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    try { unlinkSync(join(dir, f)); } catch {}
  }
}

export default {
  name: 'hermes',
  bin: 'python3',
  args: (prompt, _session) => ['-m', 'src.agent_runner', '-q', prompt],
  env: evalEnv,
  cwd: evalCwd,
  defaultPort: '8080',
  healthPath: '/pool/health',
  filterLines: (lines) => lines.filter((l) => {
    if (l.match(/^session_id:\s/)) return false;
    // Braille spinners (U+2800-U+28FF) from CLI progress display
    if (l.match(/^\s*[\u2800-\u28FF]/)) return false;
    // Kaomoji progress spinners — "◜ (°ロ°) formulating... (0.3s)" etc.
    if (l.match(/\(\d+\.\d+s\)\s*$/)) return false;
    // Tool call status lines — "┊ 🧠 memory    +user: ..."
    if (l.match(/^\s*┊/)) return false;
    return true;
  }),
  needsSessionClear: false,
  convosPath: '../../hermes/node_modules/.bin/convos',
  gateway: {
    _proc: null,
    start(port) {
      const { env: baseEnv, cwd } = buildEvalEnv();
      const env = { ...baseEnv, PORT: String(port) };
      this._proc = spawn('python3', ['-m', 'src.main'], {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this._proc.stderr.on('data', (d) => {
        const line = d.toString().trim();
        if (line) process.stderr.write(`[hermes] ${line}\n`);
      });
      // Expose the token so the convos provider can authenticate
      process.env.OPENCLAW_GATEWAY_TOKEN = env.OPENCLAW_GATEWAY_TOKEN;
    },
    stop() {
      if (this._proc) {
        this._proc.kill();
        this._proc = null;
      }
    },
  },
  memory: {
    extraArgs: [],
    reset() {
      clearDir(memoriesDir);
      clearDir(sessionsDir);
      try { unlinkSync(stateDb); } catch {}
    },
    clearSessions() {
      clearDir(sessionsDir);
      try { unlinkSync(stateDb); } catch {}
    },
    read() {
      if (!existsSync(memoriesDir)) return '';
      const files = readdirSync(memoriesDir).filter(f => f.endsWith('.md')).sort();
      return files.map(f => readFileSync(join(memoriesDir, f), 'utf-8')).join('\n\n');
    },
  },
};
