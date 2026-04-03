#!/bin/sh
# Sync workspace (skills, SOUL.md, config, prompts) to STATE_DIR.
# Sources: convos-platform (SOUL, context, shared skills) then
#          runtime workspace (config).
set -e
. "$(dirname "$0")/init.sh"

brand_section "Workspace"
brand_dim "" "sync skills, agents, and config"

# ── State directory structure ────────────────────────────────────────────
mkdir -p "$STATE_DIR/skills" "$STATE_DIR/memories" "$STATE_DIR/sessions" "$STATE_DIR/cron" "$STATE_DIR/workspace"

# ── Convos platform (SOUL.md, core skills) ───────────────────────────────
_skill_count=0
if [ -n "$CONVOS_PLATFORM_DIR" ] && [ -d "$CONVOS_PLATFORM_DIR" ]; then
  if [ -f "$CONVOS_PLATFORM_DIR/SOUL.md" ]; then
    cp "$CONVOS_PLATFORM_DIR/SOUL.md" "$STATE_DIR/SOUL.md"
    brand_ok "SOUL.md" "$STATE_DIR/SOUL.md"
  fi

  # Core skills → STATE_DIR/skills/ (discovered via config.yaml external_dirs)
  # User-created skills stay in workspace/skills/ (SKILLS_ROOT, highest priority)
  if [ -d "$CONVOS_PLATFORM_DIR/skills" ]; then
    for skill_dir in "$CONVOS_PLATFORM_DIR"/skills/*; do
      [ -d "$skill_dir" ] || continue
      skill_name="$(basename "$skill_dir")"
      rm -rf "$STATE_DIR/skills/$skill_name"
      cp -R "$skill_dir" "$STATE_DIR/skills/$skill_name"
      _skill_count=$((_skill_count + 1))
    done
  fi
  brand_ok "core skills" "$_skill_count → $STATE_DIR/skills"

  # Onboarding prompts → STATE_DIR/onboarding/
  if [ -d "$CONVOS_PLATFORM_DIR/onboarding" ]; then
    mkdir -p "$STATE_DIR/onboarding"
    cp "$CONVOS_PLATFORM_DIR"/onboarding/*.md "$STATE_DIR/onboarding/"
    brand_ok "onboarding" "$STATE_DIR/onboarding"
  fi
fi

# ── Runtime config ───────────────────────────────────────────────────────
cp "$ROOT/config.yaml" "$STATE_DIR/config.yaml"
brand_ok "config.yaml" "$STATE_DIR/config.yaml"

# ── Assemble AGENTS.md + INJECTED_CONTEXT.md from section manifests ──────
. "$LIB_DIR/agents-assemble.sh"
assemble_agents "$CONVOS_PLATFORM_DIR" "hermes" "$STATE_DIR/workspace/AGENTS.md"
assemble_agents "$CONVOS_PLATFORM_DIR" "hermes" "$STATE_DIR/workspace/INJECTED_CONTEXT.md" "INJECTED_CONTEXT.md"

brand_ok "STATE_DIR" "$STATE_DIR"
brand_done "Workspace ready"
brand_flush
