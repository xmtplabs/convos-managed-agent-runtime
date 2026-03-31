#!/bin/sh
# Platform init: load .env, resolve platform dirs, load brand helpers.
# Caller must set ROOT and _ENV_FILE before sourcing.

# Load .env
[ -f "$_ENV_FILE" ] && set -a && . "$_ENV_FILE" 2>/dev/null || true && set +a

# Resolve platform dirs
_resolve="$ROOT/../scripts/lib/resolve-shared.sh"
[ ! -f "$_resolve" ] && _resolve="/app/platform-scripts/lib/resolve-shared.sh"
if [ -f "$_resolve" ]; then
  . "$_resolve"
else
  CONVOS_PLATFORM_DIR=""
  PLATFORM_SCRIPTS_DIR=""
fi

# Brand helpers
if [ -n "${PLATFORM_SCRIPTS_DIR:-}" ] && [ -f "$PLATFORM_SCRIPTS_DIR/lib/brand.sh" ]; then
  . "$PLATFORM_SCRIPTS_DIR/lib/brand.sh"
else
  . "$ROOT/../scripts/lib/brand.sh"
fi
