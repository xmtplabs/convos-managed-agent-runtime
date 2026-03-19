#!/bin/sh
# Check Convos identity status before server launch.
# Validates identity keys, XMTP environment, and CLI availability.
set -e

. "$(dirname "$0")/lib/init.sh"

brand_section "Convos identity"

# ── XMTP environment ─────────────────────────────────────────────────────
_env="${XMTP_ENV:-}"
if [ -n "$_env" ]; then
  brand_ok "XMTP_ENV" "$_env"
else
  brand_dim "XMTP_ENV" "not set (will use CLI default)"
fi

# ── Identity keys + CLI (shared) ──────────────────────────────────────────
. "$SHARED_SCRIPTS_DIR/lib/identity-check.sh"
check_identity_keys
check_convos_cli

brand_done "Identity check complete"
brand_flush
