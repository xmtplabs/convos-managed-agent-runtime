import * as email from "./email.js";
import * as openrouter from "./openrouter.js";
import * as telnyx from "./telnyx.js";

const providers = [
  { name: "openrouter", mod: openrouter },
  { name: "email", mod: email },
  { name: "telnyx", mod: telnyx },
];

/** Resolve all providers in parallel. Returns merged envVars and handles keyed by provider name. */
export async function resolveAll(instanceId) {
  const results = await Promise.all(
    providers.map(async ({ name, mod }) => {
      const { envVars, cleanupHandle } = await mod.resolve(instanceId);
      return { name, envVars, cleanupHandle };
    })
  );

  const envVars = {};
  const handles = {};
  for (const { name, envVars: vars, cleanupHandle } of results) {
    Object.assign(envVars, vars);
    if (cleanupHandle) handles[name] = cleanupHandle;
  }
  return { envVars, handles };
}

/** Clean up all providers in parallel (best-effort). */
export async function cleanupAll(handles, instanceId) {
  await Promise.allSettled(
    providers.map(({ name, mod }) =>
      mod.cleanup(handles?.[name] ?? null, instanceId)
    )
  );
}
