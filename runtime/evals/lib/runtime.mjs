// Loads the runtime adapter for the current EVAL_RUNTIME.
// Add a new runtime by creating adapters/<name>.mjs with the same shape.

const name = process.env.EVAL_RUNTIME || 'openclaw';
export const runtime = (await import(`../adapters/${name}.mjs`)).default;
