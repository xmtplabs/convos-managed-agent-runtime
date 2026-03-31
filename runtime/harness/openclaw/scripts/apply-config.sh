#!/bin/sh
# 1. Sync workspace (includes skills), extensions. 2. Copy config template to state dir (OpenClaw substitutes ${VAR} at load from env).
set -e

. "$(dirname "$0")/init.sh"

brand_section "Workspace"
brand_dim "" "sync skills, agents, and config"

# ── Sync workspace and extensions to state dir ───────────────────────────
copy_tree_snapshot() {
  src_dir="$1"
  dst_dir="$2"

  if command -v rsync >/dev/null 2>&1; then
    rsync -a --checksum --delete "$src_dir/" "$dst_dir/"
    return
  fi

  rm -rf "$dst_dir"
  mkdir -p "$dst_dir"
  cp -R "$src_dir/." "$dst_dir/"
}

sync_workspace_dir() {
  src_dir="${1:-$RUNTIME_DIR/workspace}"
  dst_dir="$STATE_DIR/workspace"
  base_dir="$STATE_DIR/.workspace-base"

  mkdir -p "$dst_dir" "$base_dir"

  # First run: copy everything and snapshot the base
  if [ -z "$(find "$base_dir" -mindepth 1 -print -quit 2>/dev/null)" ]; then
    copy_tree_snapshot "$src_dir" "$dst_dir"
    copy_tree_snapshot "$src_dir" "$base_dir"
    return
  fi

  find "$src_dir" -type d | while IFS= read -r src_path; do
    [ "$src_path" = "$src_dir" ] && continue
    rel_path=${src_path#"$src_dir"/}
    mkdir -p "$dst_dir/$rel_path"
  done

  find "$src_dir" -type f | while IFS= read -r src_path; do
    rel_path=${src_path#"$src_dir"/}
    dst_path="$dst_dir/$rel_path"
    base_path="$base_dir/$rel_path"

    if [ ! -e "$dst_path" ]; then
      mkdir -p "$(dirname "$dst_path")"
      cp -p "$src_path" "$dst_path"
    elif [ -e "$base_path" ] && cmp -s "$dst_path" "$base_path"; then
      mkdir -p "$(dirname "$dst_path")"
      cp -p "$src_path" "$dst_path"
    fi
    # Otherwise: user-edited or user-created file — preserve
  done

  copy_tree_snapshot "$src_dir" "$base_dir"
}

# Stage workspace source from convos-platform (shared files, excluding runtime
# subdirs and the AGENTS.md template which is assembled separately).
_MERGED_SRC=""
if [ -n "${CONVOS_PLATFORM_DIR:-}" ] && [ -d "$CONVOS_PLATFORM_DIR" ]; then
  _MERGED_SRC=$(mktemp -d)
  # Copy platform files, skip per-runtime subdirs
  for _item in "$CONVOS_PLATFORM_DIR"/*; do
    _name="$(basename "$_item")"
    case "$_name" in context|openclaw|hermes) continue ;; esac
    [ "$_name" = "AGENTS.md" ] && continue  # assembled separately
    cp -R "$_item" "$_MERGED_SRC/"
  done
  # Copy openclaw-specific workspace files (e.g. TOOLS.md)
  if [ -d "$CONVOS_PLATFORM_DIR/openclaw" ]; then
    for _oc_item in "$CONVOS_PLATFORM_DIR/openclaw"/*; do
      cp -R "$_oc_item" "$_MERGED_SRC/"
    done
  fi
  brand_ok "convos-platform" "seeded"
fi

for subdir in workspace extensions; do
  [ "$subdir" = "workspace" ] && [ -n "$_MERGED_SRC" ] || [ -d "$RUNTIME_DIR/$subdir" ] || continue
  mkdir -p "$STATE_DIR/$subdir"

  if [ "$subdir" = "workspace" ]; then
    if [ -n "$_MERGED_SRC" ]; then
      sync_workspace_dir "$_MERGED_SRC"
    else
      sync_workspace_dir
    fi
  elif command -v rsync >/dev/null 2>&1; then
    rsync -a --delete --exclude=node_modules "$RUNTIME_DIR/$subdir/" "$STATE_DIR/$subdir/"
  else
    rm -rf "${STATE_DIR:?}/$subdir"/*
    cp -r "$RUNTIME_DIR/$subdir/"* "$STATE_DIR/$subdir/" 2>/dev/null || true
  fi
  brand_ok "$subdir" "$STATE_DIR/$subdir"
done

[ -n "${_MERGED_SRC:-}" ] && rm -rf "$_MERGED_SRC" && unset _MERGED_SRC

# Assemble AGENTS.md (platform template + runtime sections) — after sync so it overwrites the synced copy
if [ -n "$CONVOS_PLATFORM_DIR" ] && [ -d "$CONVOS_PLATFORM_DIR" ]; then
  . "$PLATFORM_SCRIPTS_DIR/agents-assemble.sh"
  assemble_agents "$CONVOS_PLATFORM_DIR" "$STATE_DIR/workspace/AGENTS.md" "openclaw"
fi

# Sync web-tools assets (Docker copies to /app/convos-platform/web-tools; locally we mirror here)
_SHARED_WT="$CONVOS_PLATFORM_DIR/web-tools"
if [ -d "$_SHARED_WT" ]; then
  mkdir -p "$STATE_DIR/web-tools"
  cp -r "$_SHARED_WT/"* "$STATE_DIR/web-tools/"
  brand_ok "web-tools" "$STATE_DIR/web-tools"
fi
unset _SHARED_WT

# Identity is now stored in credentials/convos-identity.json, not in the config.
cp "$RUNTIME_DIR/openclaw.json" "$CONFIG"

# Patch config when running in a container (Railway: PORT=8080, OPENCLAW_STATE_DIR=/app)
if command -v jq >/dev/null 2>&1; then
  patch_config() { jq "$@" "$CONFIG" > "$CONFIG.tmp" && mv "$CONFIG.tmp" "$CONFIG"; }

  _PORT="${OPENCLAW_PUBLIC_PORT:-${PORT:-}}"
  if [ -n "$_PORT" ] && [ "$_PORT" != "18789" ]; then
    patch_config --argjson p "$_PORT" '.gateway.port = $p | .gateway.bind = "lan"'
    brand_ok "gateway" "port $_PORT, bind lan"
  fi
  patch_config --arg w "$STATE_DIR/workspace" '.agents.defaults.workspace = $w'
  patch_config --arg d "$STATE_DIR/extensions" '.plugins = ((.plugins // {}) | .load = ((.load // {}) | .paths = [$d]))'
  if [ -n "${RAILWAY_PUBLIC_DOMAIN:-}" ]; then
    patch_config --arg origin "https://$RAILWAY_PUBLIC_DOMAIN" \
      '.gateway.trustedProxies = ["100.64.0.0/10"] | .gateway.controlUi.allowedOrigins = [($origin), "http://localhost:8080", "http://127.0.0.1:8080"]'
    brand_ok "trustedProxies" "$RAILWAY_PUBLIC_DOMAIN"
  fi
  if [ -x /usr/bin/chromium ]; then
    patch_config '.browser.executablePath = "/usr/bin/chromium" | .browser.headless = true | .browser.noSandbox = true'
    brand_ok "browser" "/usr/bin/chromium (headless, no-sandbox)"
  fi
fi

brand_ok "config" "$STATE_DIR/openclaw.json"
brand_done "Workspace ready"
brand_flush
