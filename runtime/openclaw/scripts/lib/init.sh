#!/bin/sh
# Set ROOT and state paths. Source from scripts: . "$(dirname "$0")/lib/init.sh"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# .env lives at the runtime root (one level above openclaw/)
_ENV_FILE="$ROOT/.env"
[ ! -f "$_ENV_FILE" ] && [ -f "$ROOT/../.env" ] && _ENV_FILE="$ROOT/../.env"
[ -f "$_ENV_FILE" ] && set -a && . "$_ENV_FILE" 2>/dev/null || true && set +a

# Shared workspace — Docker copies to /app/shared-workspace; locally relative to ROOT
if [ -d "$ROOT/../shared/workspace" ]; then
  SHARED_WORKSPACE_DIR="$ROOT/../shared/workspace"
elif [ -d "/app/shared-workspace" ]; then
  SHARED_WORKSPACE_DIR="/app/shared-workspace"
else
  SHARED_WORKSPACE_DIR=""
fi

# Shared scripts — Docker copies to /app/shared-scripts; locally relative to ROOT
if [ -d "$ROOT/../shared/scripts" ]; then
  SHARED_SCRIPTS_DIR="$ROOT/../shared/scripts"
elif [ -d "/app/shared-scripts" ]; then
  SHARED_SCRIPTS_DIR="/app/shared-scripts"
else
  SHARED_SCRIPTS_DIR=""
fi

. "$ROOT/scripts/lib/paths.sh"
