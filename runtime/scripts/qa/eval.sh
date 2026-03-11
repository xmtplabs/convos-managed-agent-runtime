#!/bin/sh
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
[ -f "$ROOT/.env" ] && set -a && . "$ROOT/.env" 2>/dev/null || true && set +a

# Kill the entire process group (promptfoo + child curl/sleep) on Ctrl+C
trap 'kill 0' INT TERM

EVAL_DIR="$ROOT/scripts/qa/eval"
EVAL_OUTPUT="${EVAL_OUTPUT:-}"
EVAL_JSON_OUTPUT="${EVAL_JSON_OUTPUT:-}"

# --suite=core or --suite=services to run a single suite
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

  # Per-suite output files: append suite name before extension
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
  [ "$SUITE" = "services" ] && skip="1"
  run_suite "$SUITE" "$skip"
else
  # Sequential: core (with reset) then services (skip reset, reuse conversation)
  CORE_EXIT=0
  SERVICES_EXIT=0

  echo "[eval] Running core suite..."
  echo ""
  run_suite core 0 || CORE_EXIT=$?

  echo ""
  echo "[eval] Running services suite..."
  echo ""
  run_suite services 1 || SERVICES_EXIT=$?

  echo ""
  echo "=== Eval Results ==="
  [ "$CORE_EXIT" -eq 0 ] && echo "  core:     PASS" || echo "  core:     FAIL (exit $CORE_EXIT)"
  [ "$SERVICES_EXIT" -eq 0 ] && echo "  services: PASS" || echo "  services: FAIL (exit $SERVICES_EXIT)"

  # Fail if either suite failed
  if [ "$CORE_EXIT" -ne 0 ] || [ "$SERVICES_EXIT" -ne 0 ]; then
    exit 1
  fi
fi
