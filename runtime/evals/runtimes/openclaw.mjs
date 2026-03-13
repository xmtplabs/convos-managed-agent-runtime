// Runtime adapter for OpenClaw.

export default {
  name: 'openclaw',
  bin: process.env.OPENCLAW_ENTRY || 'openclaw',
  args: (prompt, session) => ['agent', '-m', prompt, '--agent', 'main', '--session-id', session],
  healthPath: '/__openclaw__/canvas/',
  filterLines: (lines) => lines,
  needsSessionClear: true,
  convosPath: '../../../node_modules/.bin/convos', // repo root node_modules (from evals/)
};
