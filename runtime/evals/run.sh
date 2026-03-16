#!/bin/sh
# Run all eval suites. Supports any runtime via EVAL_RUNTIME env var.
# Usage: EVAL_RUNTIME=hermes sh evals/run.sh [promptfoo args...]

EVAL_DIR="$(cd "$(dirname "$0")" && pwd)"
_ENV_RUNTIME_DIR="$(cd "$EVAL_DIR/.." && pwd)"
. "$EVAL_DIR/runtimes/env.sh"

RUNTIME_LABEL="${EVAL_RUNTIME}"

# Kill any leftover eval processes from previous runs
pkill -9 -f "promptfoo eval" 2>/dev/null || true
pkill -9 -f "openclaw agent" 2>/dev/null || true
pkill -9 -f "hermes chat" 2>/dev/null || true
pkill -9 -f "convos-cli" 2>/dev/null || true
pkill -9 -f "node.*provider\.mjs" 2>/dev/null || true
sleep 1

# Kill the entire process group on Ctrl+C
trap 'kill -9 0; wait 2>/dev/null; exit 130' INT TERM

EVAL_OUTPUT="${EVAL_OUTPUT:-}"
EVAL_JSON_OUTPUT="${EVAL_JSON_OUTPUT:-}"

base_cmd="npx promptfoo eval --table-cell-max-length 1000"

if [ -n "$EVAL_OUTPUT" ]; then
  base_cmd="$base_cmd --output $EVAL_OUTPUT"
fi
if [ -n "$EVAL_JSON_OUTPUT" ]; then
  base_cmd="$base_cmd --output $EVAL_JSON_OUTPUT"
fi

failed=0

echo "=== ${RUNTIME_LABEL}: Knowledge eval (parallel) ==="
$base_cmd -c "$EVAL_DIR/suites/knows.yaml" "$@" || failed=1

echo ""
echo "=== ${RUNTIME_LABEL}: Skills eval (parallel) ==="
$base_cmd -c "$EVAL_DIR/suites/skills.yaml" "$@" || failed=1

echo ""
echo "=== ${RUNTIME_LABEL}: Soul eval (parallel) ==="
$base_cmd -c "$EVAL_DIR/suites/soul.yaml" "$@" || failed=1

echo ""
echo "=== ${RUNTIME_LABEL}: Convos lifecycle eval (sequential) ==="
$base_cmd -c "$EVAL_DIR/suites/convos.yaml" "$@" || failed=1

echo ""
echo "=== ${RUNTIME_LABEL}: Async eval (sequential) ==="
$base_cmd -c "$EVAL_DIR/suites/async.yaml" "$@" || failed=1

echo ""
echo "=== ${RUNTIME_LABEL}: Memory eval (sequential) ==="
$base_cmd -c "$EVAL_DIR/suites/memory.yaml" "$@" || failed=1

exit $failed
