// runtime/evals/async.provider.mjs
// Provider that tests the gateway stays responsive while processing a heavy task.
//
// Approach:
//   1. Fire a complex prompt via CLI (occupies the `main` lane)
//   2. While it's running, hit the gateway health endpoint + send a simple
//      prompt via the OpenAI-compatible HTTP API on a different session key
//   3. Assert both respond within threshold (proving the event loop isn't blocked)

import { spawn } from 'child_process';
import http from 'http';
import { elapsed, log as _log } from './utils.mjs';

const ENTRY = process.env.OPENCLAW_ENTRY || 'openclaw';
const GATEWAY_PORT = process.env.POOL_SERVER_PORT || process.env.PORT || process.env.GATEWAY_INTERNAL_PORT || '18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
let testIndex = 0;

function log(msg) { _log('eval:async', msg); }

function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.setTimeout(30_000, () => { req.destroy(new Error('HTTP request timed out')); });
    if (body) req.write(body);
    req.end();
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
    const delay = (meta.delay || 3) * 1000;
    const maxResponseTime = (meta.maxResponseTime || 15) * 1000;

    if (!bgPrompt) {
      return { output: '', error: 'metadata.backgroundPrompt is required' };
    }

    if (!GATEWAY_TOKEN) {
      return { output: '', error: 'OPENCLAW_GATEWAY_TOKEN is required' };
    }

    // 1. Fire complex task in background via CLI (occupies `main` lane)
    const bgSession = `eval-async-bg-${Date.now()}`;
    log(`Spawning background task on main lane: "${bgPrompt.slice(0, 60)}..."`);
    const bg = spawn(ENTRY, [
      'agent', '-m', bgPrompt, '--agent', 'main', '--session-id', bgSession,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let bgStarted = false;
    bg.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('run start') || text.includes('agent start')) bgStarted = true;
    });

    // 2. Wait for background task to engage
    log(`Waiting ${delay / 1000}s for background task to engage...`);
    await new Promise((resolve) => setTimeout(resolve, delay));

    // 3a. Health check — proves event loop isn't frozen
    const healthStart = Date.now();
    log('Checking gateway health...');
    let healthOk = false;
    try {
      const healthRes = await httpRequest({
        hostname: '127.0.0.1',
        port: GATEWAY_PORT,
        path: '/pool/health',
        method: 'GET',
        timeout: 5_000,
      });
      healthOk = healthRes.status === 200;
      log(`Health responded in ${Date.now() - healthStart}ms: ${healthOk ? 'OK' : healthRes.status}`);
    } catch (err) {
      log(`Health check failed (${Date.now() - healthStart}ms): ${err.message}`);
    }

    // 3b. Send simple prompt via HTTP API on a DIFFERENT session key
    //     This goes to a separate session lane. If main lane has concurrency >= 2
    //     or the event loop is responsive, we'll get a response.
    const fgSession = `eval-async-fg-${Date.now()}`;
    const fgStart = Date.now();
    log(`Sending foreground prompt via HTTP API (session: ${fgSession}): "${prompt}"`);

    let output = '';
    let responseTimeMs = 0;

    try {
      const body = JSON.stringify({
        model: 'openclaw',
        messages: [{ role: 'user', content: prompt }],
      });

      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: GATEWAY_PORT,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GATEWAY_TOKEN}`,
          'x-openclaw-session-key': fgSession,
          'x-openclaw-agent-id': 'main',
        },
        timeout: maxResponseTime,
      }, body);

      responseTimeMs = Date.now() - fgStart;

      if (res.status === 200) {
        const parsed = JSON.parse(res.data);
        output = parsed.choices?.[0]?.message?.content || '';
        // Strip ANSI codes
        output = output.replace(/\x1b\[[0-9;]*m/g, '').trim();
        log(`Foreground replied (${elapsed(fgStart)}): ${output.slice(0, 80)}`);
      } else {
        output = `HTTP ${res.status}: ${res.data.slice(0, 200)}`;
        log(`Foreground error (${elapsed(fgStart)}): ${output}`);
      }
    } catch (err) {
      responseTimeMs = Date.now() - fgStart;
      const timedOut = err.message.includes('timed out');
      if (timedOut) {
        log(`Foreground TIMED OUT after ${elapsed(fgStart)}`);
        output = `BLOCKED: gateway did not respond within ${maxResponseTime}ms`;
      } else {
        log(`Foreground error (${elapsed(fgStart)}): ${err.message}`);
        output = `ERROR: ${err.message}`;
      }
    }

    log(`Response time: ${responseTimeMs}ms (threshold: ${maxResponseTime}ms)`);
    log(`Health: ${healthOk ? 'PASS' : 'FAIL'}`);

    // 4. Clean up background process
    try { bg.kill(); } catch {}

    return {
      output,
      metadata: { responseTimeMs, maxResponseTime, healthOk },
    };
  }
}
