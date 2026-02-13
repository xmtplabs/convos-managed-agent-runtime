#!/bin/sh
# Source this so env vars load in the caller's shell: . scripts/env-load.sh
# Ensures .env exists, then sources it. Existing env vars are not overwritten (e.g. Railway secrets).
ROOT="${ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
if [ -f "$ROOT/.env" ]; then
  _save_token="$OPENCLAW_GATEWAY_TOKEN"
  _save_setup="$SETUP_PASSWORD"
  set -a
  . "$ROOT/.env" 2>/dev/null || true
  set +a
  [ -n "$_save_token" ] && export OPENCLAW_GATEWAY_TOKEN="$_save_token"
  [ -n "$_save_setup" ] && export SETUP_PASSWORD="$_save_setup"
  unset _save_token _save_setup
  count="$(grep -cE '^[A-Za-z_][A-Za-z0-9_]*=' "$ROOT/.env" 2>/dev/null || echo 0)"
  echo "  .env loaded ($count vars)"
fi
