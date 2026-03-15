#!/bin/sh
# Sync workspace to HERMES_HOME and bootstrap hermes-agent if needed.
set -e
. "$(dirname "$0")/lib/init.sh"

HERMES_TAG="v2026.3.12"

brand_section "Sync workspace"

# ── Bootstrap hermes-agent (one-time) ────────────────────────────────────
if [ ! -d "$HERMES_AGENT_DIR/.git" ]; then
  brand_info "hermes-agent" "cloning $HERMES_TAG ..."
  mkdir -p "$(dirname "$HERMES_AGENT_DIR")"
  git clone --recurse-submodules --branch "$HERMES_TAG" --depth 1 \
    https://github.com/NousResearch/hermes-agent.git "$HERMES_AGENT_DIR"

  brand_info "hermes-agent" "installing Python deps ..."
  cd "$HERMES_AGENT_DIR"
  uv pip install --system -e ".[all]"
  uv pip install --system -e "./mini-swe-agent"
  cd "$ROOT"

  brand_info "runtime" "installing Python deps ..."
  uv pip install --system --no-cache -r "$ROOT/requirements.txt"

  brand_ok "hermes-agent" "$HERMES_TAG (freshly installed)"
else
  brand_ok "hermes-agent" "$HERMES_TAG"
fi

# ── Node deps (one-time) ────────────────────────────────────────────────
if [ ! -d "$ROOT/node_modules/.bin" ]; then
  brand_info "node deps" "installing ..."
  cd "$ROOT" && CI=true pnpm install --frozen-lockfile
  cd "$ROOT"
  brand_ok "node deps" "installed"
else
  brand_ok "node deps" "present"
fi

# ── HERMES_HOME structure ────────────────────────────────────────────────
mkdir -p "$HERMES_HOME/skills" "$HERMES_HOME/memories" "$HERMES_HOME/sessions" "$HERMES_HOME/cron"

# ── Sync SOUL.md and config.yaml ────────────────────────────────────────
cp "$WORKSPACE_DIR/SOUL.md" "$HERMES_HOME/SOUL.md"
cp "$WORKSPACE_DIR/config.yaml" "$HERMES_HOME/config.yaml"
brand_ok "SOUL.md" "synced"

# ── Sync skills (always — picks up changes) ──────────────────────────────
_skill_count=0
for skill_dir in "$WORKSPACE_DIR"/skills/*; do
  [ -d "$skill_dir" ] || continue
  skill_name="$(basename "$skill_dir")"
  rm -rf "$HERMES_HOME/skills/$skill_name"
  cp -R "$skill_dir" "$HERMES_HOME/skills/$skill_name"
  _skill_count=$((_skill_count + 1))
done
brand_ok "skills" "$_skill_count synced to $HERMES_HOME/skills"

# ── AGENTS.md ────────────────────────────────────────────────────────────
[ -f "$WORKSPACE_DIR/AGENTS.md" ] && cp "$WORKSPACE_DIR/AGENTS.md" "$ROOT/AGENTS.md"

# ── Convos platform prompt ───────────────────────────────────────────────
[ -f "$WORKSPACE_DIR/CONVOS_PROMPT.md" ] && cp "$WORKSPACE_DIR/CONVOS_PROMPT.md" "$HERMES_HOME/CONVOS_PROMPT.md"

brand_ok "HERMES_HOME" "$HERMES_HOME"
brand_done "Workspace synced"
brand_flush
