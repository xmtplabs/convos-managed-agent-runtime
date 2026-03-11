#!/bin/sh
# Run a single eval suite. Usage: run-suite.sh <config.yaml> [promptfoo args...]
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$ROOT/.env" ] && set -a && . "$ROOT/.env" 2>/dev/null || true && set +a

SUITE="$1"; shift
# Strip leading "--" that pnpm injects
[ "$1" = "--" ] && shift
exec npx promptfoo eval -c "$ROOT/evals/$SUITE" --table-cell-max-length 1000 "$@"
