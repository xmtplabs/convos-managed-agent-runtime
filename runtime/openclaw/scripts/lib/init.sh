#!/bin/sh
# Set ROOT and state paths. Source from scripts: . "$(dirname "$0")/lib/init.sh"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# .env lives at the runtime root (one level above openclaw/)
_ENV_FILE="$ROOT/.env"
[ ! -f "$_ENV_FILE" ] && [ -f "$ROOT/../.env" ] && _ENV_FILE="$ROOT/../.env"
[ -f "$_ENV_FILE" ] && set -a && . "$_ENV_FILE" 2>/dev/null || true && set +a
. "$ROOT/scripts/lib/paths.sh"
