#!/bin/sh
# Install extension deps.
# All deps are declared in root package.json (single source of truth).
# CLIs resolve via PATH (node-path.sh).
# Skill scripts use REST APIs directly via fetch — no JS library imports needed.
set -e
export OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
. "$(dirname "$0")/lib/init.sh"

echo ""
echo "  📦 Installing extension deps"
echo "  ═══════════════════════════════════════════════"
for ext in "$EXTENSIONS_DIR"/*; do
  [ -d "$ext" ] && [ -f "$ext/package.json" ] || continue
  name=$(basename "$ext")
  echo "  📂 $name → $ext"
  (cd "$ext" && pnpm install --no-frozen-lockfile) || true
done

echo ""
echo "  🔧 Versions"
echo "  ═══════════════════════════════════════════════"
convos_ver=$(convos --version 2>/dev/null || echo "not found")
openclaw_ver=$(openclaw --version 2>/dev/null || echo "not found")
bankr_ver=$(bankr --version 2>/dev/null || echo "not found")
node_ver=$(node --version 2>/dev/null || echo "not found")
pnpm_ver=$(pnpm --version 2>/dev/null || echo "not found")
ethers_ver=$(node -e "console.log(require('ethers/package.json').version)" 2>/dev/null || echo "not found")
pg_ver=$(node -e "console.log(require('pg/package.json').version)" 2>/dev/null || echo "not found")
dotenv_ver=$(node -e "console.log(require('dotenv/package.json').version)" 2>/dev/null || echo "not found")
echo "  🧠 openclaw     → $openclaw_ver"
echo "  📡 convos       → $convos_ver"
echo "  🏦 bankr        → $bankr_ver"
echo "  ⛓  ethers       → $ethers_ver"
echo "  🐘 pg           → $pg_ver"
echo "  📄 dotenv       → $dotenv_ver"
echo "  🟢 node         → $node_ver"
echo "  📦 pnpm         → $pnpm_ver"
echo ""
echo "  ✅ install-deps done"
