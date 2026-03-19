#!/bin/sh
# Set ROOT and state paths. Source from scripts: . "$(dirname "$0")/lib/init.sh"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# .env lives at the runtime root (one level above openclaw/)
_ENV_FILE="$ROOT/.env"
[ ! -f "$_ENV_FILE" ] && [ -f "$ROOT/../.env" ] && _ENV_FILE="$ROOT/../.env"
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

. "$ROOT/scripts/lib/paths.sh"
