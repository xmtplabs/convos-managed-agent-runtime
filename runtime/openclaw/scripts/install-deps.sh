#!/bin/sh
# Install extension deps.
# All deps are declared in root package.json (single source of truth).
# CLIs resolve via PATH (node-path.sh).
# Skill scripts use REST APIs directly via fetch — no JS library imports needed.
set -e
export OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
. "$(dirname "$0")/lib/init.sh"
# Brand helpers — prefer shared copy, fall back to local
if [ -n "${SHARED_SCRIPTS_DIR:-}" ] && [ -f "$SHARED_SCRIPTS_DIR/lib/brand.sh" ]; then
  . "$SHARED_SCRIPTS_DIR/lib/brand.sh"
else
  . "$ROOT/../shared/scripts/lib/brand.sh"
fi

brand_section "Installing dependencies"

# Extensions
brand_subsection "extensions"
for ext in "$EXTENSIONS_DIR"/*; do
  [ -d "$ext" ] && [ -f "$ext/package.json" ] || continue
  name=$(basename "$ext")
  _output=$( (cd "$ext" && pnpm install --no-frozen-lockfile) 2>&1 ) || true
  _time=$(echo "$_output" | grep -o 'Done in .*' | tail -1)
  brand_ok "$name" "${_time:-installed}"
done

# Toolchain
brand_subsection "toolchain"
convos_ver=$(convos --version 2>/dev/null || echo "not found")
openclaw_ver=$(openclaw --version 2>/dev/null || echo "not found")

node_ver=$(node --version 2>/dev/null || echo "not found")
pnpm_ver=$(pnpm --version 2>/dev/null || echo "not found")
ethers_ver=$(node -e "console.log(require('ethers/package.json').version)" 2>/dev/null || echo "not found")
pg_ver=$(node -e "console.log(require('pg/package.json').version)" 2>/dev/null || echo "not found")
dotenv_ver=$(node -e "console.log(require('dotenv/package.json').version)" 2>/dev/null || echo "not found")
brand_ok "openclaw" "$openclaw_ver"
brand_ok "convos" "$convos_ver"

brand_ok "ethers" "$ethers_ver"
brand_ok "pg" "$pg_ver"
brand_ok "dotenv" "$dotenv_ver"
brand_ok "node" "$node_ver"
brand_ok "pnpm" "$pnpm_ver"

brand_done "Dependencies ready"
brand_flush
