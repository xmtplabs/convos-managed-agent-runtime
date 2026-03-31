#!/bin/sh
# Platform init: load .env, resolve platform dirs, load brand helpers.
# Caller must set ROOT and _ENV_FILE before sourcing.
#
# Two environments:
#   Local:  ROOT=harness/<runtime>  lib=harness/lib  platform=runtime/convos-platform
#   Docker: ROOT=/app               lib=/app/platform-scripts  platform=/app/convos-platform

# Load .env
[ -f "$_ENV_FILE" ] && set -a && . "$_ENV_FILE" 2>/dev/null || true && set +a

# Resolve paths — Docker vs local
if [ -d "/app/platform-scripts" ]; then
  PLATFORM_SCRIPTS_DIR="/app/platform-scripts"
  CONVOS_PLATFORM_DIR="/app/convos-platform"
else
  PLATFORM_SCRIPTS_DIR="$ROOT/../lib"
  CONVOS_PLATFORM_DIR="$ROOT/../../convos-platform"
fi

# Brand helpers
. "$PLATFORM_SCRIPTS_DIR/brand.sh"
