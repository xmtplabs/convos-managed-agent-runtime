#!/bin/sh
# Eval environment setup — the local equivalent of the production Dockerfile.
#
# Replicates what the Dockerfile does for production:
#   - Sets HERMES_HOME and copies workspace files (SOUL.md, config.yaml, skills)
#   - Copies AGENTS.md and CONVOS_PROMPT.md
#   - Clears bundled skills so only workspace skills are available (matching Docker COPY)
#   - Enables local service simulation (HERMES_EVAL_LOCAL_SERVICES=1)
#
# Sourced by bin/hermes before calling python -m src.agent_runner.

SOURCE_PATH="$0"
if [ -n "${BASH_SOURCE:-}" ]; then
  SOURCE_PATH="${BASH_SOURCE[0]}"
elif [ -n "${ZSH_VERSION:-}" ]; then
  SOURCE_PATH="$(eval 'printf %s "${(%):-%N}"')"
fi

SCRIPT_DIR="$(cd "$(dirname "$SOURCE_PATH")" && pwd)"
# Fallback: if $0 resolved to the interpreter (e.g. /bin/sh on Linux dash),
# SCRIPT_DIR won't contain this script. The caller (hermes.mjs) sets cwd to
# hermesDir, so scripts/ is a known relative path.
if [ ! -f "$SCRIPT_DIR/eval-env.sh" ]; then
  SCRIPT_DIR="$(cd "scripts" 2>/dev/null && pwd)"
fi
RUNTIME_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$RUNTIME_DIR/../.." && pwd)"

[ -f "$REPO_ROOT/runtime/.env" ] && set -a && . "$REPO_ROOT/runtime/.env" 2>/dev/null || true && set +a
export CONVOS_REPO_ROOT="$REPO_ROOT"

export HOME="$RUNTIME_DIR/.eval-home"
export HERMES_HOME="$HOME/.hermes"
mkdir -p "$HERMES_HOME/memories" "$HERMES_HOME/sessions" "$HERMES_HOME/cron"

# Clear and rebuild skills dir — only workspace skills, matching production Docker image
rm -rf "$HERMES_HOME/skills"
mkdir -p "$HERMES_HOME/skills"

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

# Load Convos platform prompt as ephemeral system prompt for CLI evals.
# Base64-encode to avoid breaking the line-by-line env parser in hermes.mjs buildEvalEnv().
if [ -f "$HERMES_HOME/CONVOS_PROMPT.md" ] && [ -z "${HERMES_EPHEMERAL_SYSTEM_PROMPT_B64:-}" ]; then
  HERMES_EPHEMERAL_SYSTEM_PROMPT_B64="$(base64 < "$HERMES_HOME/CONVOS_PROMPT.md" | tr -d '\n')"
  export HERMES_EPHEMERAL_SYSTEM_PROMPT_B64
fi

export HERMES_EVAL_LOCAL_SERVICES="${HERMES_EVAL_LOCAL_SERVICES:-1}"
export PATH="$RUNTIME_DIR/node_modules/.bin:$PATH"
