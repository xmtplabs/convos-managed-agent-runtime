// runtime/scripts/qa/eval/assertions.mjs
// Custom Promptfoo assertion functions for side-effect verification.
// These query convos-cli to verify real state on the XMTP network.

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ENV = process.env.XMTP_ENV || 'dev';

// Resolve convos binary: container path, then relative to script, then PATH
function resolveConvos() {
  const candidates = [
    '/app/node_modules/.bin/convos',                        // Docker container
    resolve(__dirname, '../../../node_modules/.bin/convos'), // local (runtime/)
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return 'convos';
}

const CONVOS = resolveConvos();

// Use the same separate HOME as the provider so we query from the eval's identity
function getConvosEnv() {
  const evalHome = process.env.EVAL_CONVOS_HOME;
  return evalHome ? { ...process.env, HOME: evalHome } : process.env;
}

function getProfiles(conversationId) {
  // Sync the conversation first so the local identity has up-to-date group state
  try {
    execSync(
      `${CONVOS} conversation messages ${conversationId} --sync --limit 1 --env ${ENV} --json`,
      { encoding: 'utf-8', timeout: 30_000, env: getConvosEnv() }
    );
  } catch {}

  const out = execSync(
    `${CONVOS} conversation profiles ${conversationId} --env ${ENV} --json`,
    { encoding: 'utf-8', timeout: 30_000, env: getConvosEnv() }
  ).trim();

  const parsed = JSON.parse(out);
  // conversation profiles returns { profiles: [...] }, not a direct array
  return parsed.profiles || parsed;
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
    const arr = Array.isArray(profiles) ? profiles : [];
    console.log(`[assertion] profileNameEquals: profiles=${JSON.stringify(arr.map(p => ({ name: p.name, inboxId: p.inboxId?.substring(0, 12) })))}`);
    const match = arr.some((p) => p.name === expectedName);
    return {
      pass: match,
      score: match ? 1 : 0,
      reason: match
        ? `Profile name is "${expectedName}"`
        : `Expected name "${expectedName}", got: ${arr.map((p) => p.name).join(', ')}`,
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
    const arr = Array.isArray(profiles) ? profiles : [];
    console.log(`[assertion] profileImageSet: profiles=${JSON.stringify(arr.map(p => ({ name: p.name, image: p.image, imageType: typeof p.image })))}`);
    const hasImage = arr.some((p) => p.image && p.image !== 'null');
    return {
      pass: hasImage,
      score: hasImage ? 1 : 0,
      reason: hasImage
        ? 'Profile image is set'
        : `Profile image is null or missing. Fields: ${JSON.stringify(arr.map(p => Object.keys(p)))}`,
    };
  } catch (err) {
    return { pass: false, score: 0, reason: `Failed to query profiles: ${err.message}` };
  }
}
