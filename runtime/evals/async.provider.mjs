// runtime/evals/async.provider.mjs
// Provider that tests the gateway main thread stays responsive under load.
//
// Approach:
//   1. Fire a complex prompt via CLI (occupies the `main` lane)
//   2. While it's running, repeatedly hit the gateway canvas endpoint
//   3. Measure gateway response times — if event loop is blocked, requests hang
//   4. After background completes (or timeout), send simple prompt to verify agent works

import { execFileSync, spawn } from 'child_process';
import http from 'http';
import { elapsed, log as _log } from './utils.mjs';

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

export default class AsyncProvider {
  id() { return 'openclaw-async'; }

  async callApi(prompt, context) {
    testIndex++;
    const desc = context.test?.description || `Test ${testIndex}`;
    const meta = context.test?.metadata || {};
    const t = Date.now();
    log(`--- ${testIndex}. ${desc} ---`);

    const bgPrompt = meta.backgroundPrompt;
    const probeCount = meta.probeCount || 5;
    const probeIntervalMs = (meta.probeInterval || 2) * 1000;
    const maxProbeLatencyMs = (meta.maxProbeLatency || 2) * 1000;

    if (!bgPrompt) {
      return { output: '', error: 'metadata.backgroundPrompt is required' };
    }

    // 1. Fire complex task in background via CLI
    const bgSession = `eval-async-bg-${Date.now()}`;
    log(`Spawning background task: "${bgPrompt.slice(0, 60)}..."`);
    const bg = spawn(ENTRY, [
      'agent', '-m', bgPrompt, '--agent', 'main', '--session-id', bgSession,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    // Wait for it to start
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // 2. Probe the gateway health while background is running
    const probeResults = [];
    for (let i = 0; i < probeCount; i++) {
      try {
        const res = await httpGet(GATEWAY_PORT, '/__openclaw__/canvas/', maxProbeLatencyMs);
        probeResults.push({ ok: res.status === 200, latencyMs: res.latencyMs });
        log(`Probe ${i + 1}/${probeCount}: ${res.status} in ${res.latencyMs}ms`);
      } catch (err) {
        probeResults.push({ ok: false, latencyMs: maxProbeLatencyMs, error: err.message });
        log(`Probe ${i + 1}/${probeCount}: FAILED (${err.message})`);
      }
      if (i < probeCount - 1) {
        await new Promise((resolve) => setTimeout(resolve, probeIntervalMs));
      }
    }

    const allProbesOk = probeResults.every((p) => p.ok);
    const maxLatency = Math.max(...probeResults.map((p) => p.latencyMs));
    const avgLatency = Math.round(probeResults.reduce((s, p) => s + p.latencyMs, 0) / probeResults.length);
    log(`Probes: ${probeResults.filter((p) => p.ok).length}/${probeCount} passed, avg ${avgLatency}ms, max ${maxLatency}ms`);

    // 3. Clean up background process
    try { bg.kill(); } catch {}

    // 4. Send simple prompt to verify agent is still functional
    const fgSession = `eval-async-fg-${Date.now()}`;
    log(`Sending foreground prompt: "${prompt}"`);
    const fgStart = Date.now();
    let output = '';

    try {
      const raw = execFileSync(ENTRY, [
        'agent', '-m', prompt, '--agent', 'main', '--session-id', fgSession,
      ], { encoding: 'utf-8', timeout: 30_000 }).trim();

      output = raw.split('\n')
        .filter((l) => !l.match(/^\d{2}:\d{2}:\d{2} \[/))
        .join('\n')
        .replace(/\x1b\[[0-9;]*m/g, '')
        .trim();

      log(`Foreground replied (${elapsed(fgStart)}): ${output.slice(0, 80)}`);
    } catch (err) {
      log(`Foreground error (${elapsed(fgStart)}): ${err.message}`);
      output = `ERROR: ${err.message}`;
    }

    const responseTimeMs = Date.now() - fgStart;

    return {
      output,
      metadata: {
        allProbesOk,
        probeCount,
        probesPassed: probeResults.filter((p) => p.ok).length,
        maxProbeLatencyMs: maxLatency,
        avgProbeLatencyMs: avgLatency,
        responseTimeMs,
        maxResponseTime: 30_000,
      },
    };
  }
}
