#!/bin/sh
# Run a single eval suite. Supports any runtime via EVAL_RUNTIME env var.
# Usage: EVAL_RUNTIME=hermes sh evals/run-suite.sh knows.yaml [promptfoo args...]

EVAL_DIR="$(cd "$(dirname "$0")" && pwd)"
_ENV_RUNTIME_DIR="$(cd "$EVAL_DIR/.." && pwd)"
. "$EVAL_DIR/runtimes/env.sh"
. "$EVAL_DIR/lib/ensure-promptfoo.sh"

SUITE="$1"; shift
# Strip leading "--" that pnpm injects
[ "$1" = "--" ] && shift
exec promptfoo eval -c "$EVAL_DIR/suites/$SUITE" --table-cell-max-length 1000 "$@"
