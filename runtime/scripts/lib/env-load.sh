#!/bin/sh
# Load .env into caller's shell. Source after init (ROOT set). Uses lib/paths.sh.
ROOT="${ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
. "$ROOT/scripts/lib/paths.sh" 2>/dev/null || true
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
if [ -f "$ROOT/.env" ]; then
  _save_token="$OPENCLAW_GATEWAY_TOKEN"
  set -a
  . "$ROOT/.env" 2>/dev/null || true
  set +a
  [ -n "$_save_token" ] && export OPENCLAW_GATEWAY_TOKEN="$_save_token"
  unset _save_token
  count="$(grep -cE '^[A-Za-z_][A-Za-z0-9_]*=' "$ROOT/.env" 2>/dev/null || echo 0)"
  echo "  📦 .env loaded ($count vars)"
fi
