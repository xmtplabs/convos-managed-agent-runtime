#!/bin/sh
# Run all eval suites. Auto-discovers from suites/*.yaml.
# Usage: EVAL_RUNTIME=hermes sh evals/run.sh [promptfoo args...]

EVAL_DIR="$(cd "$(dirname "$0")" && pwd)"
_ENV_RUNTIME_DIR="$(cd "$EVAL_DIR/.." && pwd)"
. "$EVAL_DIR/adapters/env.sh"

# Kill leftover processes from previous runs
pkill -9 -f "promptfoo eval" 2>/dev/null || true
pkill -9 -f "node.*provider\.mjs" 2>/dev/null || true
sleep 1

trap 'kill -9 0; wait 2>/dev/null; exit 130' INT TERM

EVAL_OUTPUT="${EVAL_OUTPUT:-}"
EVAL_JSON_OUTPUT="${EVAL_JSON_OUTPUT:-}"

base_cmd="npx promptfoo@0.121.3 eval -c $EVAL_DIR/base.yaml --table-cell-max-length 1000"
[ -n "$EVAL_OUTPUT" ] && base_cmd="$base_cmd --output $EVAL_OUTPUT"
[ -n "$EVAL_JSON_OUTPUT" ] && base_cmd="$base_cmd --output $EVAL_JSON_OUTPUT"

failed=0

for suite in "$EVAL_DIR"/suites/*.yaml; do
  name="$(basename "$suite" .yaml)"
  echo ""
  echo "=== ${EVAL_RUNTIME}: ${name} ==="
  $base_cmd -c "$suite" "$@" || failed=1
done

exit $failed
