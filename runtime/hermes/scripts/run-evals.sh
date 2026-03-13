#!/bin/sh
set -e

SOURCE_PATH="$0"
if [ -n "${BASH_SOURCE:-}" ]; then
  SOURCE_PATH="${BASH_SOURCE[0]}"
elif [ -n "${ZSH_VERSION:-}" ]; then
  SOURCE_PATH="$(eval 'printf %s "${(%):-%N}"')"
fi

SCRIPT_DIR="$(cd "$(dirname "$SOURCE_PATH")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

. "$SCRIPT_DIR/eval-env.sh"

export PATH="$REPO_ROOT/runtime/hermes/bin:$PATH"
export EVAL_RUNTIME=hermes

cd "$REPO_ROOT/runtime"
exec sh "$@"
