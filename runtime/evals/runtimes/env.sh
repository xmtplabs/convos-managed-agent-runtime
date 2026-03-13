#!/bin/sh
# Shared env setup for eval scripts. Sources the right .env files based on EVAL_RUNTIME.
# Usage: EVAL_RUNTIME=hermes . runtimes/env.sh
#
# To add a new runtime, add a case block below that sources its .env and sets defaults.

EVAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$EVAL_DIR/.." && pwd)"
REPO_ROOT="$(cd "$ROOT/.." && pwd)"

EVAL_RUNTIME="${EVAL_RUNTIME:-openclaw}"
export EVAL_RUNTIME

case "$EVAL_RUNTIME" in
  openclaw)
    [ -f "$ROOT/.env" ] && set -a && . "$ROOT/.env" 2>/dev/null || true && set +a
    ;;
  hermes)
    HERMES_ROOT="$REPO_ROOT/runtime-hermes"
    [ -f "$HERMES_ROOT/.env" ] && set -a && . "$HERMES_ROOT/.env" 2>/dev/null || true && set +a
    # Also source runtime/.env for eval-specific keys (EVAL_OPENROUTER_API_KEY, etc.)
    [ -f "$ROOT/.env" ] && set -a && . "$ROOT/.env" 2>/dev/null || true && set +a
    export PORT="${PORT:-8080}"
    if [ -z "$OPENCLAW_GATEWAY_TOKEN" ]; then
      echo "Error: OPENCLAW_GATEWAY_TOKEN must be set in runtime-hermes/.env" >&2
      exit 1
    fi
    ;;
  *)
    # Unknown runtime — try sourcing runtime-<name>/.env, fall back to runtime/.env
    RUNTIME_DIR="$REPO_ROOT/runtime-$EVAL_RUNTIME"
    if [ -d "$RUNTIME_DIR" ] && [ -f "$RUNTIME_DIR/.env" ]; then
      set -a && . "$RUNTIME_DIR/.env" 2>/dev/null || true && set +a
    fi
    [ -f "$ROOT/.env" ] && set -a && . "$ROOT/.env" 2>/dev/null || true && set +a
    ;;
esac

EVAL_OPENROUTER_API_KEY="${EVAL_OPENROUTER_API_KEY:-$OPENROUTER_API_KEY}"
if [ -z "$EVAL_OPENROUTER_API_KEY" ]; then
  echo "ERROR: EVAL_OPENROUTER_API_KEY (or OPENROUTER_API_KEY) is not set" >&2
  exit 1
fi
export EVAL_OPENROUTER_API_KEY
