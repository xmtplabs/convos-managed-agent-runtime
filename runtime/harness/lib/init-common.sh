#!/bin/sh
# Shared init: load .env, resolve shared dirs, load brand helpers.
# Caller must set ROOT and _ENV_FILE before sourcing.

# Load .env
[ -f "$_ENV_FILE" ] && set -a && . "$_ENV_FILE" 2>/dev/null || true && set +a

# Resolve shared dirs
_resolve="$ROOT/../harness/lib/resolve-shared.sh"
[ ! -f "$_resolve" ] && _resolve="/app/harness/lib/resolve-shared.sh"
if [ -f "$_resolve" ]; then
  . "$_resolve"
else
  CONVOS_PLATFORM_DIR=""
  HARNESS_DIR=""
  SHARED_WORKSPACE_DIR=""
  SHARED_SCRIPTS_DIR=""
fi

# Brand helpers
if [ -n "${HARNESS_DIR:-}" ] && [ -f "$HARNESS_DIR/lib/brand.sh" ]; then
  . "$HARNESS_DIR/lib/brand.sh"
else
  . "$ROOT/../harness/lib/brand.sh"
fi
