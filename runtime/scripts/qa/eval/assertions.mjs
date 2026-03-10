// runtime/scripts/qa/eval/assertions.mjs
// Custom Promptfoo assertion functions for side-effect verification.
// These query convos-cli to verify real state on the XMTP network.

import { execSync } from 'child_process';
import { resolveConvos } from './utils.mjs';

const CONVOS = resolveConvos();
const ENV = process.env.XMTP_ENV || 'dev';

function getConvosEnv() {
  const evalHome = process.env.EVAL_CONVOS_HOME;
  return evalHome ? { ...process.env, HOME: evalHome } : process.env;
}

function getProfiles(conversationId) {
  const env = getConvosEnv();
  const out = execSync(
    `${CONVOS} conversation profiles ${conversationId} --env ${ENV} --json`,
    { encoding: 'utf-8', timeout: 30_000, env }
  ).trim();
  const parsed = JSON.parse(out);
  // conversation profiles returns { profiles: [...] }, not a direct array
  return parsed.profiles || parsed;
}

function withProfiles(context, fn) {
  const conversationId = context.providerResponse?.metadata?.conversationId;
  if (!conversationId) {
    return { pass: false, score: 0, reason: 'No conversationId in provider metadata' };
  }
  execSync('sleep 3');
  try {
    const profiles = getProfiles(conversationId);
    const arr = Array.isArray(profiles) ? profiles : [];
    return fn(arr);
  } catch (err) {
    return { pass: false, score: 0, reason: `Failed to query profiles: ${err.message}` };
  }
}

/**
 * Verify agent's profile name matches expected value.
 * Usage in YAML: file://assertions.mjs:profileNameEquals
 */
export function profileNameEquals(output, context) {
  const expectedName = context.vars?.expectedName;
  if (!expectedName) {
    return { pass: false, score: 0, reason: 'Missing vars.expectedName in test config' };
  }

  return withProfiles(context, (profiles) => {
    const match = profiles.some((p) => p.name === expectedName);
    return {
      pass: match,
      score: match ? 1 : 0,
      reason: match
        ? `Profile name is "${expectedName}"`
        : `Expected name "${expectedName}", got: ${profiles.map((p) => p.name).join(', ')}`,
    };
  });
}

/**
 * Verify agent's profile image is set (non-null).
 * Usage in YAML: file://assertions.mjs:profileImageSet
 */
export function profileImageSet(output, context) {
  return withProfiles(context, (profiles) => {
    const hasImage = profiles.some((p) => p.image && p.image !== 'null');
    return {
      pass: hasImage,
      score: hasImage ? 1 : 0,
      reason: hasImage
        ? 'Profile image is set'
        : `Profile image is null or missing. Fields: ${JSON.stringify(profiles.map(p => Object.keys(p)))}`,
    };
  });
}
