#!/bin/sh
# Entrypoint for convos-runtime container.
# Volume setup lives in pool-server.js (Railway startCommand bypasses ENTRYPOINT).

# Print banner before pnpm starts so it gets its own timestamp window
# and Railway's log collector can't shuffle it with script output.
# Brand helpers — prefer shared copy, fall back to local
_ent_harness=""
[ -d "$(dirname "$0")/../harness" ] && _ent_harness="$(dirname "$0")/../harness"
[ -z "$_ent_harness" ] && [ -d "/app/harness" ] && _ent_harness="/app/harness"
if [ -n "$_ent_harness" ] && [ -f "$_ent_harness/lib/brand.sh" ]; then
  . "$_ent_harness/lib/brand.sh"
else
  . "$(dirname "$0")/../../harness/lib/brand.sh"
fi
_version="unknown"
if command -v jq >/dev/null 2>&1; then
  for _pkg in "$(dirname "$0")/../../package.json" "$(dirname "$0")/../runtime-version.json" "$(dirname "$0")/../package.json"; do
    if [ -f "$_pkg" ]; then
      _version=$(jq -r '.version // "unknown"' "$_pkg")
      [ "$_version" != "unknown" ] && break
    fi
  done
fi
brand_banner "$_version"

exec "$@"
