#!/bin/sh
# Run a single eval suite. Supports any runtime via EVAL_RUNTIME env var.
# Usage: EVAL_RUNTIME=hermes sh evals/run-suite.sh knows.yaml [promptfoo args ...]
#
# EVAL_MAX_FAILURES (default: 1) — tolerate up to N test failures per suite.
# Promptfoo exits non-zero on ANY failure; this wrapper parses the results line.

EVAL_DIR="$(cd "$(dirname "$0")" && pwd)"
_ENV_RUNTIME_DIR="$(cd "$EVAL_DIR/.." && pwd)"
. "$EVAL_DIR/adapters/env.sh"

SUITE="$1"; shift
[ "$1" = "--" ] && shift

SUITE_NAME="$(basename "$SUITE" .yaml)"

# Auto-detect: suites with only 1 test get threshold 0 (no free pass).
# Count top-level test entries (lines matching "  - description:").
_test_count=$(grep -c '^  - description:' "$EVAL_DIR/suites/$SUITE" 2>/dev/null || echo 0)
if [ "$_test_count" -le 1 ]; then
  MAX_FAILURES="${EVAL_MAX_FAILURES:-0}"
else
  MAX_FAILURES="${EVAL_MAX_FAILURES:-1}"
fi

TMPOUT=$(mktemp)

# JSON output for CI report (opt-in via EVAL_RESULTS_DIR)
JSON_FLAG=""
if [ -n "${EVAL_RESULTS_DIR:-}" ]; then
  mkdir -p "$EVAL_RESULTS_DIR"
  JSON_FLAG="--output $EVAL_RESULTS_DIR/${SUITE_NAME}.json"
fi

npx promptfoo eval -c "$EVAL_DIR/suites/$SUITE" --table-cell-max-length 1000 $JSON_FLAG "$@" > "$TMPOUT" 2>&1
EXIT_CODE=$?

cat "$TMPOUT"

if [ "$EXIT_CODE" -eq 0 ]; then
  rm -f "$TMPOUT"
  exit 0
fi

# Parse "Results: ✓ N passed, ✗ M failed, K errors (X%)"
FAILED=$(grep -oE '[0-9]+ failed' "$TMPOUT" | grep -oE '[0-9]+' || echo "999")
ERRORS=$(grep -oE '[0-9]+ error' "$TMPOUT" | head -1 | grep -oE '[0-9]+' || echo "999")
rm -f "$TMPOUT"

if [ "${ERRORS:-0}" -gt 0 ] 2>/dev/null; then
  echo "Suite had $ERRORS error(s) — failing."
  exit 1
fi

if [ "${FAILED:-999}" -le "$MAX_FAILURES" ] 2>/dev/null; then
  echo "Suite had $FAILED failure(s) within threshold ($MAX_FAILURES) — passing."
  exit 0
fi

exit 1
