#!/bin/sh
# Run a single eval suite. Supports any runtime via EVAL_RUNTIME env var.
# Usage: EVAL_RUNTIME=hermes sh evals/run-suite.sh knows.yaml [promptfoo args...]
#
# EVAL_MAX_FAILURES (default: 1) — tolerate up to N test failures per suite.
# Promptfoo exits 100 on ANY failure; this wrapper parses the results line.

EVAL_DIR="$(cd "$(dirname "$0")" && pwd)"
_ENV_RUNTIME_DIR="$(cd "$EVAL_DIR/.." && pwd)"
. "$EVAL_DIR/adapters/env.sh"

SUITE="$1"; shift
[ "$1" = "--" ] && shift

MAX_FAILURES="${EVAL_MAX_FAILURES:-1}"

# Run promptfoo, capture output while still printing it live
TMPOUT=$(mktemp)
npx promptfoo eval -c "$EVAL_DIR/suites/$SUITE" --table-cell-max-length 1000 "$@" 2>&1 | tee "$TMPOUT"
EXIT_CODE=${PIPESTATUS[0]}

if [ "$EXIT_CODE" -eq 0 ]; then
  rm -f "$TMPOUT"
  exit 0
fi

# Parse "Results: ✓ N passed, ✗ M failed, K errors (X%)"
FAILED=$(grep -oE '✗ [0-9]+ failed' "$TMPOUT" | grep -oE '[0-9]+' || echo "999")
ERRORS=$(grep -oE '[0-9]+ error' "$TMPOUT" | grep -oE '[0-9]+' | head -1 || echo "999")
rm -f "$TMPOUT"

if [ "$ERRORS" -gt 0 ] 2>/dev/null; then
  echo "Suite had $ERRORS error(s) — failing."
  exit 1
fi

if [ "$FAILED" -le "$MAX_FAILURES" ] 2>/dev/null; then
  echo "Suite had $FAILED failure(s) within threshold ($MAX_FAILURES) — passing."
  exit 0
fi

exit 1
