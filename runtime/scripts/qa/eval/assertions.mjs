// runtime/scripts/qa/eval/assertions.mjs
// Custom Promptfoo assertion functions for side-effect verification.
// These query convos-cli to verify real state on the XMTP network.

import { execSync } from 'child_process';

const ENV = process.env.XMTP_ENV || 'dev';
// Full path required — npx promptfoo doesn't source node-path.sh
const CONVOS = '/app/node_modules/.bin/convos';

function getProfiles(conversationId) {
  const out = execSync(
    `${CONVOS} conversation profiles ${conversationId} --env ${ENV} --json`,
    { encoding: 'utf-8', timeout: 30_000 }
  ).trim();
  return JSON.parse(out);
}

/**
 * Verify agent's profile name matches expected value.
 * Reads expected name from context.vars.expectedName.
 * Usage in YAML: file://assertions.mjs:profileNameEquals
 */
export function profileNameEquals(output, context) {
  const expectedName = context.vars?.expectedName;
  if (!expectedName) {
    return { pass: false, score: 0, reason: 'Missing vars.expectedName in test config' };
  }

  const conversationId = context.providerResponse?.metadata?.conversationId;
  if (!conversationId) {
    return { pass: false, score: 0, reason: 'No conversationId in provider metadata' };
  }

  // Wait briefly for profile update to propagate
  execSync('sleep 3');

  try {
    const profiles = getProfiles(conversationId);
    const match = (Array.isArray(profiles) ? profiles : []).some(
      (p) => p.name === expectedName
    );
    return {
      pass: match,
      score: match ? 1 : 0,
      reason: match
        ? `Profile name is "${expectedName}"`
        : `Expected name "${expectedName}", got: ${(Array.isArray(profiles) ? profiles : []).map((p) => p.name).join(', ')}`,
    };
  } catch (err) {
    return { pass: false, score: 0, reason: `Failed to query profiles: ${err.message}` };
  }
}

/**
 * Verify agent's profile image is set (non-null).
 * Usage in YAML: file://assertions.mjs:profileImageSet
 */
export function profileImageSet(output, context) {
  const conversationId = context.providerResponse?.metadata?.conversationId;
  if (!conversationId) {
    return { pass: false, score: 0, reason: 'No conversationId in provider metadata' };
  }

  execSync('sleep 3');

  try {
    const profiles = getProfiles(conversationId);
    const hasImage = (Array.isArray(profiles) ? profiles : []).some(
      (p) => p.image && p.image !== 'null'
    );
    return {
      pass: hasImage,
      score: hasImage ? 1 : 0,
      reason: hasImage
        ? 'Profile image is set'
        : 'Profile image is null or missing',
    };
  } catch (err) {
    return { pass: false, score: 0, reason: `Failed to query profiles: ${err.message}` };
  }
}
