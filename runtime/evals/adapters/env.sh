#!/bin/sh
# Shared env setup for eval scripts. Sources the right .env files based on EVAL_RUNTIME.
# Callers must set _ENV_RUNTIME_DIR before sourcing (path to runtime/).
#
# To add a new runtime, add a case block below that sources its .env and sets defaults.

_ENV_REPO_ROOT="$(cd "$_ENV_RUNTIME_DIR/.." && pwd)"

EVAL_RUNTIME="${EVAL_RUNTIME:-openclaw}"
export EVAL_RUNTIME

case "$EVAL_RUNTIME" in
  openclaw)
    [ -f "$_ENV_RUNTIME_DIR/.env" ] && set -a && . "$_ENV_RUNTIME_DIR/.env" 2>/dev/null || true && set +a
    # Ensure openclaw/convos binaries are on PATH (Docker: /app/node_modules, local: openclaw/node_modules)
    export PATH="$_ENV_RUNTIME_DIR/node_modules/.bin:$_ENV_RUNTIME_DIR/openclaw/node_modules/.bin:$PATH"
    if [ -z "$OPENCLAW_GATEWAY_TOKEN" ]; then
      echo "Error: OPENCLAW_GATEWAY_TOKEN must be set in runtime/.env" >&2
      exit 1
    fi
    ;;
  hermes)
    _ENV_HERMES_DIR="$_ENV_REPO_ROOT/runtime/hermes"
    [ -f "$_ENV_RUNTIME_DIR/.env" ] && set -a && . "$_ENV_RUNTIME_DIR/.env" 2>/dev/null || true && set +a
    export PATH="$_ENV_HERMES_DIR/bin:$PATH"
    export HERMES_EVAL_LOCAL_SERVICES="${HERMES_EVAL_LOCAL_SERVICES:-1}"
    if [ -z "$OPENCLAW_GATEWAY_TOKEN" ]; then
      echo "Error: OPENCLAW_GATEWAY_TOKEN must be set in runtime/.env" >&2
      exit 1
    fi
    ;;
  *)
    # Unknown runtime — try sourcing runtime-<name>/.env, fall back to runtime/.env
    _ENV_OTHER_DIR="$_ENV_REPO_ROOT/runtime-$EVAL_RUNTIME"
    if [ -d "$_ENV_OTHER_DIR" ] && [ -f "$_ENV_OTHER_DIR/.env" ]; then
      set -a && . "$_ENV_OTHER_DIR/.env" 2>/dev/null || true && set +a
    fi
    [ -f "$_ENV_RUNTIME_DIR/.env" ] && set -a && . "$_ENV_RUNTIME_DIR/.env" 2>/dev/null || true && set +a
    ;;
esac

EVAL_OPENROUTER_API_KEY="${EVAL_OPENROUTER_API_KEY:-$OPENROUTER_API_KEY}"
if [ -z "$EVAL_OPENROUTER_API_KEY" ]; then
  echo "ERROR: EVAL_OPENROUTER_API_KEY (or OPENROUTER_API_KEY) is not set" >&2
  exit 1
fi
export EVAL_OPENROUTER_API_KEY
