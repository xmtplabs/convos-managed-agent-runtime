#!/bin/sh
# Sync workspace (skills, SOUL.md, config, prompts) to HERMES_HOME.
# Sources: shared workspace (SOUL, base AGENTS, shared skills) then
#          runtime workspace (config, CONVOS_PROMPT, agents-extra).
set -e
. "$(dirname "$0")/lib/init.sh"

brand_section "Syncing workspace"

# ── HERMES_HOME structure ────────────────────────────────────────────────
mkdir -p "$HERMES_HOME/skills" "$HERMES_HOME/memories" "$HERMES_HOME/sessions" "$HERMES_HOME/cron"

# ── Shared workspace (SOUL.md, shared skills) ───────────────────────────
_skill_count=0
if [ -n "$SHARED_WORKSPACE_DIR" ] && [ -d "$SHARED_WORKSPACE_DIR" ]; then
  [ -f "$SHARED_WORKSPACE_DIR/SOUL.md" ] && cp "$SHARED_WORKSPACE_DIR/SOUL.md" "$HERMES_HOME/SOUL.md"
  brand_ok "SOUL.md" "synced (shared)"

  if [ -d "$SHARED_WORKSPACE_DIR/skills" ]; then
    for skill_dir in "$SHARED_WORKSPACE_DIR"/skills/*; do
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

# ── AGENTS.md (base + extra) — Hermes auto-loads from CWD ────────────────
_AGENTS_OUT="$ROOT/AGENTS.md"
cp "$SHARED_WORKSPACE_DIR/AGENTS-base.md" "$_AGENTS_OUT"
[ -f "$WORKSPACE_DIR/agents-extra.md" ] && cat "$WORKSPACE_DIR/agents-extra.md" >> "$_AGENTS_OUT"
brand_ok "AGENTS.md" "assembled (shared + hermes)"

# ── Convos platform prompt (hermes-only) ─────────────────────────────────
[ -f "$WORKSPACE_DIR/CONVOS_PROMPT.md" ] && cp "$WORKSPACE_DIR/CONVOS_PROMPT.md" "$HERMES_HOME/CONVOS_PROMPT.md"

brand_ok "HERMES_HOME" "$HERMES_HOME"
brand_done "Workspace synced"
brand_flush
