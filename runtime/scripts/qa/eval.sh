#!/bin/sh
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
[ -f "$ROOT/.env" ] && set -a && . "$ROOT/.env" 2>/dev/null || true && set +a

# Kill the entire process group (promptfoo + child curl/sleep) on Ctrl+C
trap 'kill 0' INT TERM

EVAL_OUTPUT="${EVAL_OUTPUT:-}"
OUTPUT_FLAGS=""
[ -n "$EVAL_OUTPUT" ] && OUTPUT_FLAGS="--output $EVAL_OUTPUT"

npx promptfoo eval -c "$ROOT/scripts/qa/eval/promptfooconfig.yaml" --table-cell-max-length 1000 $OUTPUT_FLAGS "$@"
