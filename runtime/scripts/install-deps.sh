#!/bin/sh
# Install extension deps.
# All deps are declared in root package.json (single source of truth).
# CLIs resolve via PATH (node-path.sh).
# Skill scripts use REST APIs directly via fetch — no JS library imports needed.
set -e
export OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
. "$(dirname "$0")/lib/init.sh"
. "$ROOT/scripts/lib/brand.sh"

brand_section "Installing assistant extensions"
for ext in "$EXTENSIONS_DIR"/*; do
  [ -d "$ext" ] && [ -f "$ext/package.json" ] || continue
  name=$(basename "$ext")
  _output=$( (cd "$ext" && pnpm install --no-frozen-lockfile) 2>&1 ) || true
  # Extract just the timing line (e.g. "Done in 446ms")
  _time=$(echo "$_output" | grep -o 'Done in .*' | tail -1)
  brand_ok "$name" "${_time:-installed}"
done

brand_section "Toolchain"
convos_ver=$(convos --version 2>/dev/null || echo "not found")
openclaw_ver=$(openclaw --version 2>/dev/null || echo "not found")
bankr_ver=$(bankr --version 2>/dev/null || echo "not found")
node_ver=$(node --version 2>/dev/null || echo "not found")
pnpm_ver=$(pnpm --version 2>/dev/null || echo "not found")
ethers_ver=$(node -e "console.log(require('ethers/package.json').version)" 2>/dev/null || echo "not found")
pg_ver=$(node -e "console.log(require('pg/package.json').version)" 2>/dev/null || echo "not found")
dotenv_ver=$(node -e "console.log(require('dotenv/package.json').version)" 2>/dev/null || echo "not found")
brand_ok "openclaw" "$openclaw_ver"
brand_ok "convos" "$convos_ver"
brand_ok "bankr" "$bankr_ver"
brand_ok "ethers" "$ethers_ver"
brand_ok "pg" "$pg_ver"
brand_ok "dotenv" "$dotenv_ver"
brand_ok "node" "$node_ver"
brand_ok "pnpm" "$pnpm_ver"

brand_done "Assistant extensions ready"
