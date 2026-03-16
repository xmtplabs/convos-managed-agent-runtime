// Runtime adapter for Hermes.
// Hermes uses `hermes chat -q` for single-query mode.
// Each -q call auto-creates a fresh session (no --session-id flag).
// Quiet mode prints a `session_id:` footer that must be stripped.

export default {
  name: 'hermes',
  bin: 'hermes',
  args: (prompt, _session) => ['chat', '-q', prompt, '--quiet'],
  defaultPort: '8080',
  healthPath: '/pool/health',
  filterLines: (lines) => lines.filter((l) => !l.match(/^session_id:\s/)),
  needsSessionClear: false,
  convosPath: '../../runtime-hermes/node_modules/.bin/convos',
};
