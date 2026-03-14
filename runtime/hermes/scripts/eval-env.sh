#!/bin/sh

SOURCE_PATH="$0"
if [ -n "${BASH_SOURCE:-}" ]; then
  SOURCE_PATH="${BASH_SOURCE[0]}"
elif [ -n "${ZSH_VERSION:-}" ]; then
  SOURCE_PATH="$(eval 'printf %s "${(%):-%N}"')"
fi

SCRIPT_DIR="$(cd "$(dirname "$SOURCE_PATH")" && pwd)"
RUNTIME_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$RUNTIME_DIR/../.." && pwd)"

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

# Copy AGENTS.md to eval HOME root (hermes loads it from cwd)
[ -f "$RUNTIME_DIR/workspace/AGENTS.md" ] && cp "$RUNTIME_DIR/workspace/AGENTS.md" "$HOME/AGENTS.md"

# Copy Convos platform prompt to HERMES_HOME (agent_runner.py reads it from there)
[ -f "$RUNTIME_DIR/workspace/CONVOS_PROMPT.md" ] && cp "$RUNTIME_DIR/workspace/CONVOS_PROMPT.md" "$HERMES_HOME/CONVOS_PROMPT.md"

# Load Convos platform prompt as ephemeral system prompt for CLI evals
if [ -f "$HERMES_HOME/CONVOS_PROMPT.md" ] && [ -z "${HERMES_EPHEMERAL_SYSTEM_PROMPT:-}" ]; then
  HERMES_EPHEMERAL_SYSTEM_PROMPT="$(cat "$HERMES_HOME/CONVOS_PROMPT.md")"
  export HERMES_EPHEMERAL_SYSTEM_PROMPT
fi

export HERMES_EVAL_LOCAL_SERVICES="${HERMES_EVAL_LOCAL_SERVICES:-1}"
export PATH="$RUNTIME_DIR/node_modules/.bin:$PATH"
