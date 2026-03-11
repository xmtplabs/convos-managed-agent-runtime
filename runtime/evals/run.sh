#!/bin/sh
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$ROOT/.env" ] && set -a && . "$ROOT/.env" 2>/dev/null || true && set +a

# Kill any leftover eval processes from previous runs
pkill -9 -f "promptfoo eval" 2>/dev/null || true
pkill -9 -f "openclaw agent" 2>/dev/null || true
pkill -9 -f "convos-cli" 2>/dev/null || true
pkill -9 -f "node.*provider\.mjs" 2>/dev/null || true
sleep 1

# Kill the entire process group on Ctrl+C
trap 'kill -9 0; wait 2>/dev/null; exit 130' INT TERM

if [ -z "$EVAL_OPENROUTER_API_KEY" ]; then
  echo "ERROR: EVAL_OPENROUTER_API_KEY is not set" >&2
  exit 1
fi

EVAL_DIR="$ROOT/evals"
EVAL_OUTPUT="${EVAL_OUTPUT:-}"
EVAL_JSON_OUTPUT="${EVAL_JSON_OUTPUT:-}"

base_cmd="npx promptfoo eval --table-cell-max-length 1000"

if [ -n "$EVAL_OUTPUT" ]; then
  base_cmd="$base_cmd --output $EVAL_OUTPUT"
fi
if [ -n "$EVAL_JSON_OUTPUT" ]; then
  base_cmd="$base_cmd --output $EVAL_JSON_OUTPUT"
fi

echo "=== Prompt eval (parallel) ==="
$base_cmd -c "$EVAL_DIR/prompt.yaml" "$@"
prompt_exit=$?

echo ""
echo "=== Convos lifecycle eval (sequential) ==="
$base_cmd -c "$EVAL_DIR/convos.yaml" "$@"
convos_exit=$?

# Exit with failure if either suite failed
[ $prompt_exit -ne 0 ] || [ $convos_exit -ne 0 ] && exit 1
exit 0
