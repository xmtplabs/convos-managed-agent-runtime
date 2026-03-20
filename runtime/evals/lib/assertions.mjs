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



export function profileMetadataEquals(output, context) {
  const key = context.test?.metadata?.expectedMetadataKey;
  const value = context.test?.metadata?.expectedMetadataValue;
  if (!key) return { pass: false, score: 0, reason: 'Missing metadata.expectedMetadataKey' };
  if (value === undefined) return { pass: false, score: 0, reason: 'Missing metadata.expectedMetadataValue' };

  return withProfiles(context, (profiles) => {
    const match = profiles.some((p) => {
      const raw = p.metadata?.[key];
      if (raw == null) return false;
      // Handle both plain values and typed objects ({ type, value })
      const actual = raw && typeof raw === 'object' && 'value' in raw ? String(raw.value) : String(raw);
      return actual === String(value);
    });
    return {
      pass: match,
      score: match ? 1 : 0,
      reason: match
        ? `Profile metadata ${key}="${value}"`
        : `Expected ${key}="${value}", got: ${profiles.map((p) => JSON.stringify(p.metadata || {})).join(', ')}`,
    };
  });
}

export function profileHasInstanceId(output, context) {
  return withProfiles(context, (profiles) => {
    const match = profiles.some((p) => {
      const raw = p.metadata?.instanceId;
      // Handle both plain string and typed object ({ type, value })
      return raw && (typeof raw === 'string' || (typeof raw === 'object' && 'value' in raw));
    });
    const found = profiles.find((p) => p.metadata?.instanceId);
    const val = found?.metadata?.instanceId;
    const display = val && typeof val === 'object' && 'value' in val ? val.value : val;
    return {
      pass: match,
      score: match ? 1 : 0,
      reason: match
        ? `Profile metadata has instanceId: ${display}`
        : `No profile has instanceId in metadata: ${profiles.map((p) => JSON.stringify(p.metadata || {})).join(', ')}`,
    };
  });
}

export function profileHasAttestation(output, context) {
  return withProfiles(context, (profiles) => {
    const agent = profiles.find((p) => {
      const att = p.metadata?.attestation;
      const ts = p.metadata?.attestation_ts;
      const kid = p.metadata?.attestation_kid;
      // Handle both plain strings and typed objects ({ type, value })
      const hasAtt = att && (typeof att === 'string' || (typeof att === 'object' && 'value' in att));
      const hasTs = ts && (typeof ts === 'string' || (typeof ts === 'object' && 'value' in ts));
      const hasKid = kid && (typeof kid === 'string' || (typeof kid === 'object' && 'value' in kid));
      return hasAtt && hasTs && hasKid;
    });
    if (!agent) {
      return {
        pass: false,
        score: 0,
        reason: `No profile has attestation metadata: ${profiles.map((p) => JSON.stringify(p.metadata || {})).join(', ')}`,
      };
    }
    const val = (v) => v && typeof v === 'object' && 'value' in v ? v.value : v;
    return {
      pass: true,
      score: 1,
      reason: `Profile has attestation (kid=${val(agent.metadata.attestation_kid)}, ts=${val(agent.metadata.attestation_ts)}, sig=${String(val(agent.metadata.attestation)).slice(0, 16)}...)`,
    };
  });
}

export function attestationSurvivesProfileUpdate(output, context) {
  // This assertion runs AFTER the agent has updated its profile (name/image/metadata).
  // It checks that the attestation fields are still present — the CLI merges metadata,
  // so they should survive.
  return profileHasAttestation(output, context);
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

export function followUpResponded(output, context) {
  const meta = context.providerResponse?.metadata || {};
  const error = meta.followUpError;
  if (error) {
    return { pass: false, score: 0, reason: `Follow-up query failed: ${error}` };
  }
  if (!output || !output.trim()) {
    return { pass: false, score: 0, reason: 'Follow-up query returned empty response' };
  }
  return { pass: true, score: 1, reason: 'Follow-up query returned a response' };
}

// Silence indicators per runtime — empty output or any of these exact strings
// means the agent intentionally chose not to reply.
const SILENCE_TOKENS = new Set(['', 'SILENT', 'No reply from agent.', 'completed']);

export function agentChoseSilence(output) {
  const trimmed = (output || '').trim();
  const pass = SILENCE_TOKENS.has(trimmed);
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? `Agent chose silence (output: ${trimmed ? `"${trimmed}"` : 'empty'})`
      : `Expected silence, got: "${trimmed.slice(0, 120)}"`,
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

export function cronPingsReceived(output, context) {
  const meta = context.providerResponse?.metadata || {};
  const pings = meta.cronPings;
  const pingTexts = meta.cronPingTexts || [];

  if (pings == null) {
    return { pass: false, score: 0, reason: 'No cronPings in provider metadata — cronWait handler may not have run' };
  }

  if (pings < 1) {
    return { pass: false, score: 0, reason: `Expected at least 1 cron ping, got ${pings}. Cron delivery to Convos may be broken.` };
  }

  // Verify at least one ping contains "ping" — proves the cron payload was
  // delivered with actual content, not just a SILENT/empty response.
  const hasPingContent = pingTexts.some(t => /ping/i.test(t));
  const pass = hasPingContent;
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? `Received ${pings} cron pings, content verified (${pingTexts[0]?.slice(0, 40)})`
      : `Received ${pings} cron pings but none contain "ping" — content: [${pingTexts.map(t => `"${t.slice(0, 30)}"`).join(', ')}]`,
  };
}

export function cronJobDeleted(output, context) {
  const meta = context.providerResponse?.metadata || {};
  const cleanedUp = meta.cleanedUp;

  if (cleanedUp == null) {
    return { pass: false, score: 0, reason: 'No cleanedUp in provider metadata — cronCleanupPrompt may be missing' };
  }

  return {
    pass: cleanedUp,
    score: cleanedUp ? 1 : 0,
    reason: cleanedUp
      ? 'Agent confirmed cron job deletion'
      : 'Agent did not confirm cron job deletion within timeout',
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
