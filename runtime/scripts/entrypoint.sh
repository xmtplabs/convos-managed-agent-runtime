#!/bin/sh
# Entrypoint for convos-runtime container.
# Volume setup lives in pool-server.js (Railway startCommand bypasses ENTRYPOINT).

# Print banner before pnpm starts so it gets its own timestamp window
# and Railway's log collector can't shuffle it with script output.
. "$(dirname "$0")/lib/brand.sh"
_version="unknown"
if command -v jq >/dev/null 2>&1 && [ -f "$(dirname "$0")/../package.json" ]; then
  _version=$(jq -r '.version // "unknown"' "$(dirname "$0")/../package.json")
fi
brand_banner "$_version"

exec "$@"
