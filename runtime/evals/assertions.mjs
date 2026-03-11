// runtime/evals/assertions.mjs
// Custom Promptfoo assertion functions for side-effect verification.

import { execFileSync } from 'child_process';
import { resolveConvos } from './utils.mjs';

const CONVOS = resolveConvos();
const ENV = process.env.XMTP_ENV || 'dev';

function sleep(ms) {
  const buf = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buf), 0, 0, ms);
}

function convosEnv() {
  const home = process.env.EVAL_CONVOS_HOME;
  return home ? { ...process.env, HOME: home } : process.env;
}

function getProfiles(conversationId) {
  const out = execFileSync(CONVOS, [
    'conversation', 'profiles', conversationId, '--env', ENV, '--json',
  ], { encoding: 'utf-8', timeout: 30_000, env: convosEnv() }).trim();
  const parsed = JSON.parse(out);
  return parsed.profiles || parsed;
}

function withProfiles(context, fn) {
  const id = context.providerResponse?.metadata?.conversationId;
  if (!id) return { pass: false, score: 0, reason: 'No conversationId in provider metadata' };
  // Wait for XMTP profile changes to propagate
  sleep(3_000);
  try {
    const profiles = getProfiles(id);
    return fn(Array.isArray(profiles) ? profiles : []);
  } catch (err) {
    return { pass: false, score: 0, reason: `Failed to query profiles: ${err.message}` };
  }
}

export function profileNameEquals(output, context) {
  const expected = context.test?.metadata?.expectedName || context.vars?.expectedName;
  if (!expected) return { pass: false, score: 0, reason: 'Missing metadata.expectedName' };

  return withProfiles(context, (profiles) => {
    const match = profiles.some((p) => p.name === expected);
    return {
      pass: match,
      score: match ? 1 : 0,
      reason: match
        ? `Profile name is "${expected}"`
        : `Expected "${expected}", got: ${profiles.map((p) => p.name).join(', ')}`,
    };
  });
}

export function profileImageSet(output, context) {
  return withProfiles(context, (profiles) => {
    const has = profiles.some((p) => p.image && p.image !== 'null');
    return {
      pass: has,
      score: has ? 1 : 0,
      reason: has ? 'Profile image is set' : 'Profile image is null or missing',
    };
  });
}

export function agentSelfDestructed(output) {
  const pass = output === 'SELF_DESTRUCT_CONFIRMED';
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass ? 'Agent self-destructed' : `Expected SELF_DESTRUCT_CONFIRMED, got: ${output}`,
  };
}
