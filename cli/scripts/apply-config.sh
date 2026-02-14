#!/bin/sh
# 1. Replace workspace files. 2. Replace skills folder. 3. Substitute .env into JSON and write config.
set -e

. "$(dirname "$0")/lib/init.sh"
. "$ROOT/cli/scripts/lib/env-load.sh"

echo ""
echo "  🧠 Uploading brain"
echo "  ═══════════════════"

. "$ROOT/cli/scripts/lib/sync-workspace.sh"
. "$ROOT/cli/scripts/lib/sync-skills.sh"
. "$ROOT/cli/scripts/lib/sync-extensions.sh"

export TEMPLATE_PATH="$ROOT/openclaw.json"
export ENV_FILE="$ROOT/.env"
export CONFIG_OUTPUT="$CONFIG"
node "$ROOT/cli/scripts/apply-config.cjs"

echo "  ✨ done"
echo ""
