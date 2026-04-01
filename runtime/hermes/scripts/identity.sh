#!/bin/sh
# Check Convos identity status before server launch.
# Validates identity keys, XMTP environment, and CLI availability.
set -e

. "$(dirname "$0")/init.sh"

brand_section "Identity"
brand_dim "" "verify XMTP credentials and Convos CLI"

# ── XMTP environment ─────────────────────────────────────────────────────
_env="${XMTP_ENV:-}"
if [ -n "$_env" ]; then
  brand_ok "XMTP_ENV" "$_env"
else
  brand_dim "XMTP_ENV" "not set (will use CLI default)"
fi

# ── Identity keys + CLI (shared) ──────────────────────────────────────────
. "$LIB_DIR/identity-check.sh"
check_identity_keys
check_convos_cli

brand_done "Identity check complete"
brand_flush
