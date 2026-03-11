#!/bin/sh
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$ROOT/.env" ] && set -a && . "$ROOT/.env" 2>/dev/null || true && set +a

# Kill the entire process group (promptfoo + child curl/sleep) on Ctrl+C
trap 'kill 0' INT TERM

EVAL_DIR="$ROOT/evals"
EVAL_OUTPUT="${EVAL_OUTPUT:-}"
EVAL_JSON_OUTPUT="${EVAL_JSON_OUTPUT:-}"

cmd="npx promptfoo eval -c $EVAL_DIR/promptfooconfig.yaml --table-cell-max-length 1000"

if [ -n "$EVAL_OUTPUT" ]; then
  cmd="$cmd --output $EVAL_OUTPUT"
fi
if [ -n "$EVAL_JSON_OUTPUT" ]; then
  cmd="$cmd --output $EVAL_JSON_OUTPUT"
fi

$cmd "$@"
