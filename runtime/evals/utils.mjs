// runtime/evals/utils.mjs
// Shared utilities for eval providers and assertions.

import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function resolveConvos() {
  const candidates = [
    '/app/node_modules/.bin/convos',                        // Docker container
    resolve(__dirname, '../../../node_modules/.bin/convos'), // local (runtime/)
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return 'convos';
}

export function sleep(ms) {
  const buf = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buf), 0, 0, ms);
}

export function elapsed(start) {
  return `${((Date.now() - start) / 1000).toFixed(1)}s`;
}

export function log(prefix, msg) {
  console.log(`[${prefix}] ${msg}`);
}
