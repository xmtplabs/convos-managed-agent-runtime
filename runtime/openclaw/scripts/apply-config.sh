#!/bin/sh
# 1. Sync workspace (includes skills), extensions. 2. Copy config template to state dir (OpenClaw substitutes ${VAR} at load from env).
set -e

. "$(dirname "$0")/lib/init.sh"
. "$ROOT/scripts/lib/env-load.sh"
. "$ROOT/scripts/lib/brand.sh"

brand_section "Uploading assistant brain"

. "$ROOT/scripts/lib/sync-openclaw.sh"

mkdir -p "$STATE_DIR"

# Identity is now stored in credentials/convos-identity.json, not in the config.
cp "$RUNTIME_DIR/openclaw.json" "$CONFIG"

# Patch config when running in a container (Railway: PORT=8080, OPENCLAW_STATE_DIR=/app)
if command -v jq >/dev/null 2>&1; then
  _PORT="${OPENCLAW_PUBLIC_PORT:-${PORT:-}}"
  if [ -n "$_PORT" ] && [ "$_PORT" != "18789" ]; then
    jq --argjson p "$_PORT" '.gateway.port = $p | .gateway.bind = "lan"' "$CONFIG" > "$CONFIG.tmp" && mv "$CONFIG.tmp" "$CONFIG"
    brand_ok "gateway" "port $_PORT, bind lan"
  fi
  # Workspace path must match where we sync; ~/.openclaw/workspace is wrong when STATE_DIR=/app
  if [ -n "$OPENCLAW_STATE_DIR" ]; then
    jq --arg w "$STATE_DIR/workspace" '.agents.defaults.workspace = $w' "$CONFIG" > "$CONFIG.tmp" && mv "$CONFIG.tmp" "$CONFIG"
    # Force plugin load from synced extensions so /web-tools/* routes work on Railway
    jq --arg d "$STATE_DIR/extensions" '.plugins = ((.plugins // {}) | .load = ((.load // {}) | .paths = [$d]))' "$CONFIG" > "$CONFIG.tmp" && mv "$CONFIG.tmp" "$CONFIG"
  fi
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
brand_done "Assistant brain ready"
brand_flush
