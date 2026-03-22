// runtime/evals/lifecycle-http.provider.mjs
// Lightweight provider that hits gateway lifecycle HTTP endpoints directly.
// No XMTP, no convos CLI — just fetch() against the running gateway.

import { log as _log, elapsed } from '../lib/utils.mjs';
import { runtime } from '../lib/runtime.mjs';

let testIndex = 0;

function log(msg) { _log('eval:lifecycle-http', msg); }

function gatewayUrl(path) {
  const port = process.env.GATEWAY_PORT || runtime.defaultPort;
  return `http://localhost:${port}${path}`;
}

function headers() {
  return {
    'Authorization': `Bearer ${process.env.OPENCLAW_GATEWAY_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

async function fetchJson(method, path) {
  const url = gatewayUrl(path);
  const res = await fetch(url, { method, headers: headers() });
  const body = await res.text();
  let json;
  try { json = JSON.parse(body); } catch { json = null; }
  return { status: res.status, body, json };
}

export default class LifecycleHttpProvider {
  id() { return 'lifecycle-http'; }

  async callApi(prompt, context) {
    testIndex++;
    const desc = context.test?.description || `Test ${testIndex}`;
    const action = context.test?.metadata?.action;
    const t = Date.now();
    log(`--- ${testIndex}. ${desc} ---`);

    try {
      if (action === 'status') {
        const { status, json, body } = await fetchJson('GET', '/convos/status');
        log(`Status ${status} (${elapsed(t)}): ${body.slice(0, 200)}`);
        if (status !== 200 || !json) {
          return { output: '', error: `Status endpoint returned ${status}: ${body.slice(0, 200)}` };
        }
        return { output: JSON.stringify(json), metadata: { httpStatus: status } };
      }

      if (action === 'reset') {
        const { status, json, body } = await fetchJson('POST', '/convos/reset');
        log(`Reset ${status} (${elapsed(t)}): ${body.slice(0, 200)}`);
        if (status !== 200 || !json) {
          return { output: '', error: `Reset endpoint returned ${status}: ${body.slice(0, 200)}` };
        }
        return { output: JSON.stringify(json), metadata: { httpStatus: status } };
      }

      if (action === 'health') {
        const port = process.env.GATEWAY_PORT || runtime.defaultPort;
        const url = `http://localhost:${port}${runtime.healthPath}`;
        const res = await fetch(url);
        log(`Health ${res.status} (${elapsed(t)})`);
        return { output: String(res.status), metadata: { httpStatus: res.status } };
      }

      return { output: '', error: `Unknown action: ${action}` };
    } catch (err) {
      log(`Error (${elapsed(t)}): ${err.message}`);
      return { output: '', error: err.message };
    }
  }
}
