#!/bin/sh
# Sync workspace (skills, SOUL.md, config, prompts) to HERMES_HOME.
# Sources: convos-platform (SOUL, AGENTS template, shared skills) then
#          convos-platform/hermes (config, section files).
set -e
. "$(dirname "$0")/init.sh"

brand_section "Workspace"
brand_dim "" "sync skills, agents, and config"

# ── HERMES_HOME structure ────────────────────────────────────────────────
mkdir -p "$HERMES_HOME/skills" "$HERMES_HOME/memories" "$HERMES_HOME/sessions" "$HERMES_HOME/cron"

# ── Convos platform (SOUL.md, shared skills) ─────────────────────────────
_skill_count=0
if [ -n "$CONVOS_PLATFORM_DIR" ] && [ -d "$CONVOS_PLATFORM_DIR" ]; then
  [ -f "$CONVOS_PLATFORM_DIR/SOUL.md" ] && cp "$CONVOS_PLATFORM_DIR/SOUL.md" "$HERMES_HOME/SOUL.md"
  [ -f "$CONVOS_PLATFORM_DIR/CUSTOMIZATION.md" ] && cp "$CONVOS_PLATFORM_DIR/CUSTOMIZATION.md" "$HERMES_HOME/CUSTOMIZATION.md"
  brand_ok "SOUL.md" "synced (platform)"

  if [ -d "$CONVOS_PLATFORM_DIR/skills" ]; then
    for skill_dir in "$CONVOS_PLATFORM_DIR"/skills/*; do
      [ -d "$skill_dir" ] || continue
      skill_name="$(basename "$skill_dir")"
      rm -rf "$HERMES_HOME/skills/$skill_name"
      cp -R "$skill_dir" "$HERMES_HOME/skills/$skill_name"
      _skill_count=$((_skill_count + 1))
    done
  fi
  brand_ok "shared skills" "$_skill_count synced"
fi

# ── Runtime config ───────────────────────────────────────────────────────
_HERMES_PLATFORM_DIR="$CONVOS_PLATFORM_DIR/hermes"
cp "$ROOT/config.yaml" "$HERMES_HOME/config.yaml"
brand_ok "config.yaml" "synced"

for skill_dir in "$_HERMES_PLATFORM_DIR"/skills/*; do
  [ -d "$skill_dir" ] || continue
  skill_name="$(basename "$skill_dir")"
  rm -rf "$HERMES_HOME/skills/$skill_name"
  cp -R "$skill_dir" "$HERMES_HOME/skills/$skill_name"
  _skill_count=$((_skill_count + 1))
done

# ── AGENTS.md (platform template + runtime sections) → HERMES_HOME
. "$PLATFORM_SCRIPTS_DIR/lib/agents-assemble.sh"
assemble_agents "$CONVOS_PLATFORM_DIR" "$_HERMES_PLATFORM_DIR" "$HERMES_HOME/AGENTS.md" "hermes"

brand_ok "HERMES_HOME" "${HERMES_HOME##*/}"
brand_done "Workspace ready"
brand_flush
