#!/bin/sh
# Run a single eval suite against Hermes. Usage: run-hermes-suite.sh <config.yaml> [promptfoo args...]
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HERMES_ROOT="$REPO_ROOT/runtime-hermes"

# Source runtime-hermes/.env for PORT, OPENCLAW_GATEWAY_TOKEN, etc.
[ -f "$HERMES_ROOT/.env" ] && set -a && . "$HERMES_ROOT/.env" 2>/dev/null || true && set +a
# Source runtime/.env for EVAL_OPENROUTER_API_KEY and other eval config
[ -f "$ROOT/.env" ] && set -a && . "$ROOT/.env" 2>/dev/null || true && set +a

if [ -z "$OPENCLAW_GATEWAY_TOKEN" ]; then
  echo "Error: OPENCLAW_GATEWAY_TOKEN must be set in runtime-hermes/.env" >&2
  exit 1
fi

EVAL_OPENROUTER_API_KEY="${EVAL_OPENROUTER_API_KEY:-$OPENROUTER_API_KEY}"
if [ -z "$EVAL_OPENROUTER_API_KEY" ]; then
  echo "ERROR: EVAL_OPENROUTER_API_KEY (or OPENROUTER_API_KEY) is not set" >&2
  exit 1
fi
export EVAL_OPENROUTER_API_KEY

export EVAL_RUNTIME=hermes
export PORT="${PORT:-8080}"

SUITE="$1"; shift
# Strip leading "--" that pnpm injects
[ "$1" = "--" ] && shift
exec npx promptfoo eval -c "$ROOT/evals/$SUITE" --table-cell-max-length 1000 "$@"
