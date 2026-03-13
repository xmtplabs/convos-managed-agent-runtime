#!/bin/sh
# Run the full eval suite against the Hermes runtime.
# Expects runtime-hermes/.env to be configured with OPENCLAW_GATEWAY_TOKEN, PORT, etc.
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RUNTIME_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HERMES_ROOT="$REPO_ROOT/runtime-hermes"

# Source runtime-hermes/.env for PORT, OPENCLAW_GATEWAY_TOKEN, etc.
if [ -f "$HERMES_ROOT/.env" ]; then
  set -a
  . "$HERMES_ROOT/.env" 2>/dev/null || true
  set +a
fi

# Also source runtime/.env for EVAL_OPENROUTER_API_KEY and other eval config
if [ -f "$RUNTIME_ROOT/.env" ]; then
  set -a
  . "$RUNTIME_ROOT/.env" 2>/dev/null || true
  set +a
fi

# Validate gateway token — hermes auto-generates one if not set,
# but the eval runner needs to know it too.
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

# Tell providers to use hermes CLI + paths
export EVAL_RUNTIME=hermes
export PORT="${PORT:-8080}"

# Kill any leftover eval processes from previous runs
pkill -9 -f "promptfoo eval" 2>/dev/null || true
pkill -9 -f "hermes chat" 2>/dev/null || true
pkill -9 -f "convos-cli" 2>/dev/null || true
pkill -9 -f "node.*provider\.mjs" 2>/dev/null || true
sleep 1

# Kill the entire process group on Ctrl+C
trap 'kill -9 0; wait 2>/dev/null; exit 130' INT TERM

EVAL_DIR="$RUNTIME_ROOT/evals"
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

echo "=== Hermes: Knowledge eval (parallel) ==="
$base_cmd -c "$EVAL_DIR/knows.yaml" "$@" || failed=1

echo ""
echo "=== Hermes: Skills eval (parallel) ==="
$base_cmd -c "$EVAL_DIR/skills.yaml" "$@" || failed=1

echo ""
echo "=== Hermes: Soul eval (parallel) ==="
$base_cmd -c "$EVAL_DIR/soul.yaml" "$@" || failed=1

echo ""
echo "=== Hermes: Convos lifecycle eval (sequential) ==="
$base_cmd -c "$EVAL_DIR/convos.yaml" "$@" || failed=1

echo ""
echo "=== Hermes: Async eval (sequential) ==="
$base_cmd -c "$EVAL_DIR/async.yaml" "$@" || failed=1

exit $failed
