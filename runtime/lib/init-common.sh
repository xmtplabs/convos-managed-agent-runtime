#!/bin/sh
# Shared init: load .env, resolve shared dirs, load brand helpers.
# Caller must set ROOT and _ENV_FILE before sourcing.

# Load .env
[ -f "$_ENV_FILE" ] && set -a && . "$_ENV_FILE" 2>/dev/null || true && set +a

# Resolve shared dirs
_resolve="$ROOT/../lib/resolve-shared.sh"
[ ! -f "$_resolve" ] && _resolve="/app/lib/resolve-shared.sh"
if [ -f "$_resolve" ]; then
  . "$_resolve"
else
  CONVOS_PLATFORM_DIR=""
  LIB_DIR=""
  SHARED_WORKSPACE_DIR=""
  SHARED_SCRIPTS_DIR=""
fi

# Brand helpers
if [ -n "${LIB_DIR:-}" ] && [ -f "$LIB_DIR/brand.sh" ]; then
  . "$LIB_DIR/brand.sh"
else
  . "$ROOT/../lib/brand.sh"
fi
