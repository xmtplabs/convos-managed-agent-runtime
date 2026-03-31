#!/bin/sh
set -e
. "$(dirname "$0")/init.sh"
. "$PLATFORM_SCRIPTS_DIR/keys-boot.sh"

# ── Hermes ────────────────────────────────────────────────────────────────
brand_subsection "hermes"
keys_ensure_gateway_token

_model="${OPENCLAW_PRIMARY_MODEL:-${HERMES_MODEL:-anthropic/claude-sonnet-4-6}}"
brand_ok "MODEL" "$_model"
brand_ok "XMTP_ENV" "${XMTP_ENV:-dev}"

keys_show_services
keys_write_env
brand_flush
