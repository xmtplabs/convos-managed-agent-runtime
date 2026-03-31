#!/bin/sh
# Resolve CONVOS_PLATFORM_DIR and PLATFORM_SCRIPTS_DIR paths.
# Requires: ROOT must be set before sourcing.

if [ -d "$ROOT/../convos-platform" ]; then
  CONVOS_PLATFORM_DIR="$ROOT/../convos-platform"
elif [ -d "/app/convos-platform" ]; then
  CONVOS_PLATFORM_DIR="/app/convos-platform"
else
  CONVOS_PLATFORM_DIR=""
fi

if [ -d "$ROOT/../scripts" ]; then
  PLATFORM_SCRIPTS_DIR="$ROOT/../scripts"
elif [ -d "/app/platform-scripts" ]; then
  PLATFORM_SCRIPTS_DIR="/app/platform-scripts"
else
  PLATFORM_SCRIPTS_DIR=""
fi
