#!/bin/sh
# Unified eval dispatcher.
# Usage:
#   sh evals/eval.sh [runtime] [suite] [promptfoo args...]
#
# Examples:
#   pnpm eval                        # all openclaw suites
#   pnpm eval hermes                 # all hermes suites
#   pnpm eval hermes skills          # single hermes suite
#   pnpm eval openclaw memory        # single openclaw suite
#   pnpm eval skills                 # single openclaw suite (default runtime)

EVAL_DIR="$(cd "$(dirname "$0")" && pwd)"
_ENV_RUNTIME_DIR="$(cd "$EVAL_DIR/.." && pwd)"

# Strip pnpm's injected "--"
[ "$1" = "--" ] && shift

SUITES="knows skills soul convos async memory poller"

# Parse args: first arg could be a runtime or a suite name
ARG1="${1:-}"
ARG2="${2:-}"

is_suite() { echo "$SUITES" | grep -qw "$1"; }
is_runtime() { [ "$1" = "hermes" ] || [ "$1" = "openclaw" ]; }

if is_runtime "$ARG1"; then
  export EVAL_RUNTIME="$ARG1"
  shift
  SUITE="${1:-}"; [ -n "$SUITE" ] && shift
elif is_suite "$ARG1"; then
  export EVAL_RUNTIME="${EVAL_RUNTIME:-openclaw}"
  SUITE="$ARG1"; shift
else
  export EVAL_RUNTIME="${EVAL_RUNTIME:-openclaw}"
  SUITE=""
fi

. "$EVAL_DIR/adapters/env.sh"

if [ -n "$SUITE" ]; then
  # Single suite
  exec npx promptfoo eval -c "$EVAL_DIR/suites/$SUITE.yaml" --table-cell-max-length 1000 "$@"
else
  # All suites
  exec sh "$EVAL_DIR/run.sh" "$@"
fi
