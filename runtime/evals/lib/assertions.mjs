// runtime/evals/assertions.mjs
// Custom Promptfoo assertion functions for side-effect verification.

import { execFileSync } from 'child_process';
import { resolveConvos, sleep } from './utils.mjs';

const CONVOS = resolveConvos();
const ENV = process.env.XMTP_ENV || 'dev';

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
  sleep(8_000);
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
      reason: has
        ? 'Profile image is set'
        : 'Profile image is null or missing',
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

export function gatewayHealthDuringLoad(output, context) {
  const meta = context.providerResponse?.metadata || {};
  const pass = meta.healthOk === true;
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? 'Gateway health endpoint responded during load'
      : 'Gateway health endpoint did not respond — event loop may be blocked',
  };
}

export function agentDelegatedHeavyTask(output, context) {
  const meta = context.providerResponse?.metadata || {};
  const ack = meta.heavyAck || '';
  const duration = meta.heavyDurationMs;
  const error = meta.heavyError;

  if (error) {
    return { pass: false, score: 0, reason: `Heavy task errored: ${error}` };
  }

  // The agent should have acknowledged quickly and spawned a sub-agent.
  // Check the ack mentions delegation (spawn, background, working on it, etc.)
  const delegationSignals = /spawn|sub.?agent|background|working on|on it|report back|get back|let me|i'll/i;
  const hasTextAck = delegationSignals.test(ack);
  // Hermes: the 👀 reaction is the ack (sent via adapter), not text output.
  // When the heavy task is still processing, the HTTP response is empty — that's expected.
  const emptyAck = ack.trim().length === 0;

  // Also check it didn't return the full result inline (which would mean it blocked)
  const tooLong = ack.length > 500;

  const pass = (hasTextAck || emptyAck) && !tooLong;
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? emptyAck
        ? `Agent delegated in ${duration}ms (empty ack — reaction-based acknowledgment)`
        : `Agent delegated in ${duration}ms: "${ack.slice(0, 80)}"`
      : tooLong
        ? `Agent returned full result inline (${ack.length} chars, ${duration}ms) instead of delegating`
        : `Agent ack'd in ${duration}ms but no delegation signal found: "${ack.slice(0, 120)}"`,
  };
}

export function memoryFileUpdated(output, context) {
  const contents = context.providerResponse?.metadata?.memoryContents || '';

  // Filter out frontmatter, section headers, and italicized placeholder text.
  // What remains should be substantive content the agent actually wrote.
  const lines = contents.split('\n').filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;                         // blank
    if (trimmed === '---') return false;                // frontmatter delimiter
    if (trimmed.startsWith('#')) return false;           // section header
    if (/^_.*_$/.test(trimmed)) return false;           // italicized placeholder
    if (/^title:|^summary:/.test(trimmed)) return false; // frontmatter fields
    return true;
  });

  const pass = lines.length > 0;
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? `Memory has ${lines.length} substantive line(s) beyond the template`
      : 'Memory still matches the empty template — agent did not write to memory',
  };
}

export function responseTimeBelowThreshold(output, context) {
  const meta = context.providerResponse?.metadata || {};
  const actual = meta.responseTimeMs;
  const threshold = meta.maxResponseTime;

  if (actual == null || threshold == null) {
    return { pass: false, score: 0, reason: 'Missing responseTimeMs or maxResponseTime in metadata' };
  }

  const pass = actual <= threshold;
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? `Response time ${actual}ms is within ${threshold}ms threshold`
      : `Response time ${actual}ms exceeds ${threshold}ms threshold`,
  };
}
