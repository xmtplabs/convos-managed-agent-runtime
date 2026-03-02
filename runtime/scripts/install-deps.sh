#!/bin/sh
# Install extension deps.
# All deps are declared in root package.json (single source of truth).
# CLIs (@bankr/cli, agent-cards, etc.) resolve via PATH (node-path.sh).
# Skill scripts use REST APIs directly via fetch — no JS library imports needed.
set -e
export OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
. "$(dirname "$0")/lib/init.sh"

# Extensions: pnpm install in each dir with package.json (always run to fix stale/partial installs)
for ext in "$EXTENSIONS_DIR"/*; do
  [ -d "$ext" ] && [ -f "$ext/package.json" ] || continue
  echo "  Installing deps: $ext"
  (cd "$ext" && pnpm install --no-frozen-lockfile) || true
done

echo "  install-deps done"
