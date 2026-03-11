#!/bin/sh
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
[ -f "$ROOT/.env" ] && set -a && . "$ROOT/.env" 2>/dev/null || true && set +a

# Kill the entire process group (promptfoo + child curl/sleep) on Ctrl+C
trap 'kill 0' INT TERM

EVAL_DIR="$ROOT/scripts/qa/eval"
EVAL_OUTPUT="${EVAL_OUTPUT:-}"
EVAL_JSON_OUTPUT="${EVAL_JSON_OUTPUT:-}"

# --suite=X to run a single suite (init, core, services, teardown)
SUITE=""
PASSTHROUGH=""
for arg in "$@"; do
  case "$arg" in
    --suite=*) SUITE="${arg#--suite=}" ;;
    *) PASSTHROUGH="$PASSTHROUGH $arg" ;;
  esac
done

run_suite() {
  suite="$1"
  skip_reset="$2"
  config="$EVAL_DIR/${suite}.yaml"
  if [ ! -f "$config" ]; then
    echo "[eval] Config not found: $config" >&2
    return 1
  fi

  cmd="npx promptfoo eval -c $config --table-cell-max-length 1000"

  if [ -n "$EVAL_OUTPUT" ]; then
    ext="${EVAL_OUTPUT##*.}"
    base="${EVAL_OUTPUT%.*}"
    cmd="$cmd --output ${base}-${suite}.${ext}"
  fi
  if [ -n "$EVAL_JSON_OUTPUT" ]; then
    ext="${EVAL_JSON_OUTPUT##*.}"
    base="${EVAL_JSON_OUTPUT%.*}"
    cmd="$cmd --output ${base}-${suite}.${ext}"
  fi

  EVAL_SUITE_NAME="$suite" EVAL_SKIP_RESET="$skip_reset" $cmd $PASSTHROUGH
}

if [ -n "$SUITE" ]; then
  # Single suite mode
  skip="0"
  [ "$SUITE" != "init" ] && skip="1"
  run_suite "$SUITE" "$skip"
  exit $?
fi

# === Full run: init → core + services (parallel) → teardown ===

INIT_EXIT=0
CORE_EXIT=0
SERVICES_EXIT=0
TEARDOWN_EXIT=0

# Phase 1: Init (reset, join, welcome test)
echo "[eval] === Phase 1: Init ==="
echo ""
run_suite init 0 || INIT_EXIT=$?

if [ "$INIT_EXIT" -ne 0 ]; then
  echo ""
  echo "=== Eval Results ==="
  echo "  init:     FAIL (exit $INIT_EXIT)"
  echo "  core:     SKIP"
  echo "  services: SKIP"
  echo "  teardown: SKIP"
  exit 1
fi

# Phase 2: Core + Services in parallel
echo ""
echo "[eval] === Phase 2: Core + Services (parallel) ==="
echo ""

run_suite core 1 &
CORE_PID=$!

run_suite services 1 &
SERVICES_PID=$!

wait $CORE_PID || CORE_EXIT=$?
wait $SERVICES_PID || SERVICES_EXIT=$?

# Phase 3: Teardown (self-destruct)
echo ""
echo "[eval] === Phase 3: Teardown ==="
echo ""
run_suite teardown 1 || TEARDOWN_EXIT=$?

# Summary
echo ""
echo "=== Eval Results ==="
echo "  init:     PASS"
[ "$CORE_EXIT" -eq 0 ] && echo "  core:     PASS" || echo "  core:     FAIL (exit $CORE_EXIT)"
[ "$SERVICES_EXIT" -eq 0 ] && echo "  services: PASS" || echo "  services: FAIL (exit $SERVICES_EXIT)"
[ "$TEARDOWN_EXIT" -eq 0 ] && echo "  teardown: PASS" || echo "  teardown: FAIL (exit $TEARDOWN_EXIT)"

# Fail if any suite failed
if [ "$CORE_EXIT" -ne 0 ] || [ "$SERVICES_EXIT" -ne 0 ] || [ "$TEARDOWN_EXIT" -ne 0 ]; then
  exit 1
fi
