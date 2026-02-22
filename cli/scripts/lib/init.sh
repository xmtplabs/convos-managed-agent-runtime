#!/bin/sh
# Set ROOT and state paths. Source from scripts: . "$(dirname "$0")/../lib/init.sh"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
[ -f "$ROOT/.env" ] && set -a && . "$ROOT/.env" 2>/dev/null || true && set +a
. "$ROOT/cli/scripts/lib/paths.sh"
