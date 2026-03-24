// Backwards-compatible shim: existing Railway instances use
// startCommand "node scripts/pool-server" but the real file
// now lives at src/pool-server.js.
require("../src/pool-server.js");
