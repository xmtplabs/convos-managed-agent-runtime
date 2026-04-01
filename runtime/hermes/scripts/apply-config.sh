#!/bin/sh
# Sync workspace (skills, SOUL.md, config, prompts) to HERMES_HOME.
# Sources: convos-platform (SOUL, context, shared skills) then
#          runtime workspace (config, agents-extra).
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
  [ -f "$CONVOS_PLATFORM_DIR/context/CUSTOMIZATION.md" ] && cp "$CONVOS_PLATFORM_DIR/context/CUSTOMIZATION.md" "$HERMES_HOME/CUSTOMIZATION.md"
  brand_ok "SOUL.md" "synced (convos-platform)"

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

# ── Runtime workspace (config, runtime-only skills overlay) ──────────────
cp "$WORKSPACE_DIR/config.yaml" "$HERMES_HOME/config.yaml"
brand_ok "config.yaml" "synced"

for skill_dir in "$WORKSPACE_DIR"/skills/*; do
  [ -d "$skill_dir" ] || continue
  skill_name="$(basename "$skill_dir")"
  rm -rf "$HERMES_HOME/skills/$skill_name"
  cp -R "$skill_dir" "$HERMES_HOME/skills/$skill_name"
  _skill_count=$((_skill_count + 1))
done

# ── AGENTS.md (manifest + context files) ─────────────────────────────────
. "$HARNESS_DIR/lib/agents-assemble.sh"
assemble_agents "$CONVOS_PLATFORM_DIR" "hermes" "$ROOT/AGENTS.md"

# ── Generate CONVOS_PLATFORM.md for agent_runner.py backward compat ──────
_cp="$HERMES_HOME/CONVOS_PLATFORM.md"
: > "$_cp"
for _ctx_name in IDENTITY MESSAGING TOOL-DISCIPLINE INBOUND-FORMATS CONVOS-CLI PROFILE-UPDATES; do
  _ctx_runtime="$CONVOS_PLATFORM_DIR/context/hermes/$_ctx_name.md"
  _ctx_shared="$CONVOS_PLATFORM_DIR/context/$_ctx_name.md"
  if [ -f "$_ctx_runtime" ]; then
    cat "$_ctx_runtime" >> "$_cp"; printf '\n\n' >> "$_cp"
  elif [ -f "$_ctx_shared" ]; then
    cat "$_ctx_shared" >> "$_cp"; printf '\n\n' >> "$_cp"
  fi
done
brand_ok "CONVOS_PLATFORM.md" "generated (hermes)"

brand_ok "HERMES_HOME" "$HERMES_HOME"
brand_done "Workspace ready"
brand_flush
