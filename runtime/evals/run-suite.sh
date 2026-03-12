#!/bin/sh
# Run a single eval suite. Usage: run-suite.sh <config.yaml> [promptfoo args...]
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$ROOT/.env" ] && set -a && . "$ROOT/.env" 2>/dev/null || true && set +a

EVAL_OPENROUTER_API_KEY="${EVAL_OPENROUTER_API_KEY:-$OPENROUTER_API_KEY}"
if [ -z "$EVAL_OPENROUTER_API_KEY" ]; then
  echo "ERROR: EVAL_OPENROUTER_API_KEY (or OPENROUTER_API_KEY) is not set" >&2
  exit 1
fi
export EVAL_OPENROUTER_API_KEY

SUITE="$1"; shift
# Strip leading "--" that pnpm injects
[ "$1" = "--" ] && shift
exec npx promptfoo eval -c "$ROOT/evals/$SUITE" --table-cell-max-length 1000 "$@"
