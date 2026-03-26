#!/bin/sh
# Unified eval entry point.
# Usage:
#   pnpm evals <runtime> [suite]       — run one suite or all
#   pnpm evals hermes memory           — run memory suite against hermes
#   pnpm evals openclaw skills         — run skills suite against openclaw
#   pnpm evals hermes                  — run all suites against hermes
#
# Extra args are forwarded to promptfoo (e.g. --filter-pattern "browse").

set -e

RUNTIME="${1:?Usage: pnpm evals <runtime> [suite] [promptfoo args...]}"
shift

# Strip pnpm's injected "--"
[ "${1:-}" = "--" ] && shift

SUITE="${1:-}"
[ -n "$SUITE" ] && shift

export EVAL_RUNTIME="$RUNTIME"

EVAL_DIR="$(cd "$(dirname "$0")" && pwd)"

# Match init.sh default: STATE_DIR="${OPENCLAW_STATE_DIR:-$ROOT/.openclaw-dev}"
# so the eval clears sessions from the same dir the running agent uses.
if [ -z "$OPENCLAW_STATE_DIR" ] && [ "$RUNTIME" = "openclaw" ]; then
  export OPENCLAW_STATE_DIR="$EVAL_DIR/../openclaw/.openclaw-dev"
fi

if [ -n "$SUITE" ]; then
  exec sh "$EVAL_DIR/run-suite.sh" "${SUITE}.yaml" "$@"
else
  exec sh "$EVAL_DIR/run.sh" "$@"
fi
