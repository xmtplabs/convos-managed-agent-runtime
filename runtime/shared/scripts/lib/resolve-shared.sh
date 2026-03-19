#!/bin/sh
# Resolve SHARED_WORKSPACE_DIR and SHARED_SCRIPTS_DIR paths.
# Requires: ROOT must be set before sourcing.

if [ -d "$ROOT/../shared/workspace" ]; then
  SHARED_WORKSPACE_DIR="$ROOT/../shared/workspace"
elif [ -d "/app/shared-workspace" ]; then
  SHARED_WORKSPACE_DIR="/app/shared-workspace"
else
  SHARED_WORKSPACE_DIR=""
fi

if [ -d "$ROOT/../shared/scripts" ]; then
  SHARED_SCRIPTS_DIR="$ROOT/../shared/scripts"
elif [ -d "/app/shared-scripts" ]; then
  SHARED_SCRIPTS_DIR="/app/shared-scripts"
else
  SHARED_SCRIPTS_DIR=""
fi
