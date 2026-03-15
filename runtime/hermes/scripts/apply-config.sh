#!/bin/sh
# Sync workspace (skills, SOUL.md, config, prompts) to HERMES_HOME.
set -e
. "$(dirname "$0")/lib/init.sh"

brand_section "Syncing workspace"

# ── HERMES_HOME structure ────────────────────────────────────────────────
mkdir -p "$HERMES_HOME/skills" "$HERMES_HOME/memories" "$HERMES_HOME/sessions" "$HERMES_HOME/cron"

# ── SOUL.md and config.yaml ─────────────────────────────────────────────
cp "$WORKSPACE_DIR/SOUL.md" "$HERMES_HOME/SOUL.md"
cp "$WORKSPACE_DIR/config.yaml" "$HERMES_HOME/config.yaml"
brand_ok "SOUL.md" "synced"
brand_ok "config.yaml" "synced"

# ── Skills (always — picks up changes) ───────────────────────────────────
_skill_count=0
for skill_dir in "$WORKSPACE_DIR"/skills/*; do
  [ -d "$skill_dir" ] || continue
  skill_name="$(basename "$skill_dir")"
  rm -rf "$HERMES_HOME/skills/$skill_name"
  cp -R "$skill_dir" "$HERMES_HOME/skills/$skill_name"
  _skill_count=$((_skill_count + 1))
done
brand_ok "skills" "$_skill_count synced"

# ── AGENTS.md ────────────────────────────────────────────────────────────
[ -f "$WORKSPACE_DIR/AGENTS.md" ] && cp "$WORKSPACE_DIR/AGENTS.md" "$ROOT/AGENTS.md"

# ── Convos platform prompt ───────────────────────────────────────────────
[ -f "$WORKSPACE_DIR/CONVOS_PROMPT.md" ] && cp "$WORKSPACE_DIR/CONVOS_PROMPT.md" "$HERMES_HOME/CONVOS_PROMPT.md"

brand_ok "HERMES_HOME" "$HERMES_HOME"
brand_done "Workspace synced"
brand_flush
