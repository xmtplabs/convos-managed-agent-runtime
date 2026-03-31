#!/bin/sh
set -e
. "$(dirname "$0")/init.sh"
. "$PLATFORM_SCRIPTS_DIR/keys-boot.sh"

# ── OpenClaw ──────────────────────────────────────────────────────────────
brand_subsection "openclaw"
keys_ensure_gateway_token

if [ -n "$OPENCLAW_PRIMARY_MODEL" ]; then
  brand_ok "OPENCLAW_PRIMARY_MODEL" "$OPENCLAW_PRIMARY_MODEL"
else
  brand_dim "OPENCLAW_PRIMARY_MODEL" "not set"
fi

if [ -n "$XMTP_ENV" ]; then
  brand_ok "XMTP_ENV" "$XMTP_ENV"
else
  brand_dim "XMTP_ENV" "not set"
fi

keys_show_services
keys_write_env
brand_flush
