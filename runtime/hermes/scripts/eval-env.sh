#!/bin/sh
set -e

SOURCE_PATH="$0"
if [ -n "${BASH_SOURCE:-}" ]; then
  SOURCE_PATH="${BASH_SOURCE[0]}"
elif [ -n "${ZSH_VERSION:-}" ]; then
  SOURCE_PATH="$(eval 'printf %s "${(%):-%N}"')"
fi

SCRIPT_DIR="$(cd "$(dirname "$SOURCE_PATH")" && pwd)"
RUNTIME_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$RUNTIME_DIR/.." && pwd)"

[ -f "$RUNTIME_DIR/.env" ] && set -a && . "$RUNTIME_DIR/.env" 2>/dev/null || true && set +a
[ -f "$REPO_ROOT/runtime/.env" ] && set -a && . "$REPO_ROOT/runtime/.env" 2>/dev/null || true && set +a
export CONVOS_REPO_ROOT="$REPO_ROOT"

export HOME="$RUNTIME_DIR/.eval-home"
export HERMES_HOME="$HOME/.hermes"
mkdir -p "$HERMES_HOME/skills" "$HERMES_HOME/memories" "$HERMES_HOME/sessions" "$HERMES_HOME/cron"

cp "$RUNTIME_DIR/workspace/SOUL.md" "$HERMES_HOME/SOUL.md"
cp "$RUNTIME_DIR/workspace/config.yaml" "$HERMES_HOME/config.yaml"
for skill_dir in "$RUNTIME_DIR"/workspace/skills/*; do
  [ -d "$skill_dir" ] || continue
  skill_name="$(basename "$skill_dir")"
  rm -rf "$HERMES_HOME/skills/$skill_name"
  cp -R "$skill_dir" "$HERMES_HOME/skills/$skill_name"
done

export HERMES_EVAL_LOCAL_SERVICES="${HERMES_EVAL_LOCAL_SERVICES:-1}"
: "${HERMES_EPHEMERAL_SYSTEM_PROMPT:=For long multi-step research, comparison, or web-heavy tasks: reply with one short sentence like \"I am on it and will report back.\" and then stop. Do not call any tools. Do not browse, search, execute code, delegate, or continue after that sentence.}"
export HERMES_EPHEMERAL_SYSTEM_PROMPT
export PATH="$RUNTIME_DIR/node_modules/.bin:$PATH"
