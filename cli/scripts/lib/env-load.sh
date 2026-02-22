#!/bin/sh
# Load .env.<OPENCLAW_ENV> into caller's shell. Source after init (ROOT set). Uses lib/paths.sh.
ROOT="${ROOT:-$(cd "$(dirname "$0")/../../.." && pwd)}"
. "$ROOT/cli/scripts/lib/paths.sh" 2>/dev/null || true
OPENCLAW_ENV="${OPENCLAW_ENV:-dev}"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
if [ -f "$ENV_FILE" ]; then
  _save_token="$OPENCLAW_GATEWAY_TOKEN"
  _save_setup="$SETUP_PASSWORD"
  set -a
  . "$ENV_FILE" 2>/dev/null || true
  set +a
  [ -n "$_save_token" ] && export OPENCLAW_GATEWAY_TOKEN="$_save_token"
  [ -n "$_save_setup" ] && export SETUP_PASSWORD="$_save_setup"
  unset _save_token _save_setup
  count="$(grep -cE '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE" 2>/dev/null || echo 0)"
  echo "  📦 .env loaded ($count vars)"
else
  echo "  ⚠️  $ENV_FILE not found"
fi
