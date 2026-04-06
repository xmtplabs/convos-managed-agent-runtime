#!/bin/sh
# Run a single eval suite. Supports any runtime via EVAL_RUNTIME env var.
# Usage: EVAL_RUNTIME=hermes sh evals/run-suite.sh knows.yaml [promptfoo args ...]
#
# EVAL_MAX_FAILURES (default: 1) — tolerate up to N test failures + errors per suite.
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

# Install promptfoo with pinned @asamuzakjp/css-color to avoid ESM top-level await crash
PFOO_DIR="${EVAL_DIR}/.promptfoo-install"
if [ ! -x "$PFOO_DIR/node_modules/.bin/promptfoo" ]; then
  mkdir -p "$PFOO_DIR"
  cat > "$PFOO_DIR/package.json" <<'PJSON'
{"private":true,"overrides":{"@asamuzakjp/css-color":"4.1.2"},"dependencies":{"promptfoo":"0.121.3"}}
PJSON
  (cd "$PFOO_DIR" && npm install --no-audit --no-fund --ignore-scripts 2>&1 | tail -1)
fi

set +e
"$PFOO_DIR/node_modules/.bin/promptfoo" eval -c "$EVAL_DIR/suites/$SUITE" --grader "openrouter:@preset/assistants-ci" --table-cell-max-length 1000 $JSON_FLAG "$@" 2>&1 | tee "$TMPOUT"
# tee always exits 0; derive the real exit code from the results line
EXIT_CODE=0
if grep -qE '✗ [0-9]+ failed|[0-9]+ error' "$TMPOUT"; then
  EXIT_CODE=1
fi
# If promptfoo crashed before producing results, fail hard
if ! grep -qE '✓ [0-9]+ passed' "$TMPOUT"; then
  echo "ERROR: promptfoo did not produce results — likely crashed."
  rm -f "$TMPOUT"
  exit 1
fi
set -e

if [ "$EXIT_CODE" -eq 0 ]; then
  rm -f "$TMPOUT"
  exit 0
fi

# Parse "Results: ✓ N passed, ✗ M failed, K errors (X%)"
FAILED=$(grep -oE '[0-9]+ failed' "$TMPOUT" | grep -oE '[0-9]+' || echo "999")
ERRORS=$(grep -oE '[0-9]+ error' "$TMPOUT" | head -1 | grep -oE '[0-9]+' || echo "999")
rm -f "$TMPOUT"

TOTAL=$(( ${FAILED:-999} + ${ERRORS:-0} ))

if [ "$TOTAL" -le "$MAX_FAILURES" ] 2>/dev/null; then
  echo "Suite had $FAILED failure(s) + $ERRORS error(s) within threshold ($MAX_FAILURES) — passing."
  exit 0
fi

echo "Suite had $FAILED failure(s) + $ERRORS error(s), exceeds threshold ($MAX_FAILURES) — failing."
exit 1
