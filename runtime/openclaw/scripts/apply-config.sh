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

  bootstrap_sync=0
  if [ -z "$(find "$base_dir" -mindepth 1 -print -quit 2>/dev/null)" ]; then
    bootstrap_sync=1
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
      continue
    fi

    if [ ! -e "$base_path" ]; then
      [ "$bootstrap_sync" = "1" ] && continue
      continue
    fi

    if cmp -s "$dst_path" "$base_path"; then
      mkdir -p "$(dirname "$dst_path")"
      cp -p "$src_path" "$dst_path"
    fi
  done

  copy_tree_snapshot "$src_dir" "$base_dir"
}

# Stage merged workspace source: convos-platform files + runtime overlay → single sync call.
_MERGED_SRC=""
if [ -n "${CONVOS_PLATFORM_DIR:-}" ] && [ -d "$CONVOS_PLATFORM_DIR" ]; then
  _MERGED_SRC=$(mktemp -d)
  cp -R "$CONVOS_PLATFORM_DIR/." "$_MERGED_SRC/"
  [ -d "$RUNTIME_DIR/workspace" ] && cp -R "$RUNTIME_DIR/workspace/." "$_MERGED_SRC/"
  # Copy TOOLS.md from harness/openclaw if present
  [ -n "${HARNESS_DIR:-}" ] && [ -f "$HARNESS_DIR/openclaw/TOOLS.md" ] && cp "$HARNESS_DIR/openclaw/TOOLS.md" "$_MERGED_SRC/TOOLS.md"
  brand_ok "convos-platform" "merged with runtime"
fi

for subdir in workspace extensions; do
  [ -d "$RUNTIME_DIR/$subdir" ] || { [ "$subdir" = "workspace" ] && [ -n "$_MERGED_SRC" ]; } || continue
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

mkdir -p "$STATE_DIR"

# Assemble AGENTS.md (manifest + context files) — after sync so it overwrites the synced copy
if [ -n "${HARNESS_DIR:-}" ] && [ -f "$HARNESS_DIR/lib/agents-assemble.sh" ]; then
  . "$HARNESS_DIR/lib/agents-assemble.sh"
  assemble_agents "$CONVOS_PLATFORM_DIR" "openclaw" "$STATE_DIR/workspace/AGENTS.md"
else
  echo "⚠ HARNESS_DIR not set — skipping agents-assemble" >&2
fi

# Generate CONVOS_PLATFORM.md from per-turn injection manifest
_cp="$STATE_DIR/workspace/CONVOS_PLATFORM.md"
_injection="$CONVOS_PLATFORM_DIR/injection.json"
: > "$_cp"
if [ -f "$_injection" ] && command -v jq >/dev/null 2>&1; then
  _per_turn=$(jq -r '.per_turn[]' "$_injection")
else
  _per_turn="TOOL-DISCIPLINE INBOUND-FORMATS CONVOS-CLI PROFILE-UPDATES CRON"
fi
for _ctx_name in $_per_turn; do
  _ctx_runtime="$CONVOS_PLATFORM_DIR/context/openclaw/$_ctx_name.md"
  _ctx_shared="$CONVOS_PLATFORM_DIR/context/$_ctx_name.md"
  [ -f "$_ctx_runtime" ] && cat "$_ctx_runtime" >> "$_cp" && printf '\n---\n\n' >> "$_cp"
  [ -f "$_ctx_shared" ] && cat "$_ctx_shared" >> "$_cp" && printf '\n---\n\n' >> "$_cp"
done
brand_ok "CONVOS_PLATFORM.md" "generated from injection.json (openclaw)"

# Sync shared web-tools assets
_SHARED_WT="${CONVOS_PLATFORM_DIR:-}/web-tools"
[ ! -d "$_SHARED_WT" ] && _SHARED_WT="$ROOT/../convos-platform/web-tools"
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
  _PORT="${OPENCLAW_PUBLIC_PORT:-${PORT:-}}"
  if [ -n "$_PORT" ] && [ "$_PORT" != "18789" ]; then
    jq --argjson p "$_PORT" '.gateway.port = $p | .gateway.bind = "lan"' "$CONFIG" > "$CONFIG.tmp" && mv "$CONFIG.tmp" "$CONFIG"
    brand_ok "gateway" "port $_PORT, bind lan"
  fi
  # Workspace path must match where we sync; template says ~/.openclaw/workspace but STATE_DIR may differ
  jq --arg w "$STATE_DIR/workspace" '.agents.defaults.workspace = $w' "$CONFIG" > "$CONFIG.tmp" && mv "$CONFIG.tmp" "$CONFIG"
  # Plugin load paths must point at synced extensions
  jq --arg d "$STATE_DIR/extensions" '.plugins = ((.plugins // {}) | .load = ((.load // {}) | .paths = [$d]))' "$CONFIG" > "$CONFIG.tmp" && mv "$CONFIG.tmp" "$CONFIG"
  # Trust Railway's internal proxy so connections are treated as local,
  # and whitelist the instance's public domain for the control UI.
  if [ -n "${RAILWAY_PUBLIC_DOMAIN:-}" ]; then
    jq --arg origin "https://$RAILWAY_PUBLIC_DOMAIN" \
      '.gateway.trustedProxies = ["100.64.0.0/10"] | .gateway.controlUi.allowedOrigins = [($origin), "http://localhost:8080", "http://127.0.0.1:8080"]' \
      "$CONFIG" > "$CONFIG.tmp" && mv "$CONFIG.tmp" "$CONFIG"
    brand_ok "trustedProxies" "$RAILWAY_PUBLIC_DOMAIN"
  fi
  # Inject browser config when running in a container with chromium installed
  if [ -x /usr/bin/chromium ]; then
    jq '.browser.executablePath = "/usr/bin/chromium" | .browser.headless = true | .browser.noSandbox = true' \
      "$CONFIG" > "$CONFIG.tmp" && mv "$CONFIG.tmp" "$CONFIG"
    brand_ok "browser" "/usr/bin/chromium (headless, no-sandbox)"
  fi
fi
unset _PORT

brand_ok "config" "$CONFIG"
brand_done "Workspace ready"
brand_flush
