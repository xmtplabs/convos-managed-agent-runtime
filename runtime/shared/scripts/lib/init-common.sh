#!/bin/sh
# Shared init: load .env, resolve shared dirs, load brand helpers.
# Caller must set ROOT and _ENV_FILE before sourcing.

# Load .env
[ -f "$_ENV_FILE" ] && set -a && . "$_ENV_FILE" 2>/dev/null || true && set +a

# Resolve shared dirs
_resolve="$ROOT/../shared/scripts/lib/resolve-shared.sh"
[ ! -f "$_resolve" ] && _resolve="/app/shared-scripts/lib/resolve-shared.sh"
if [ -f "$_resolve" ]; then
  . "$_resolve"
else
  SHARED_WORKSPACE_DIR=""
  SHARED_SCRIPTS_DIR=""
fi

# Brand helpers
if [ -n "${SHARED_SCRIPTS_DIR:-}" ] && [ -f "$SHARED_SCRIPTS_DIR/lib/brand.sh" ]; then
  . "$SHARED_SCRIPTS_DIR/lib/brand.sh"
else
  . "$ROOT/../shared/scripts/lib/brand.sh"
fi
