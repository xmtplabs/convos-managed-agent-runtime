#!/bin/sh
# Check Convos identity status — credentials, identity keys, CLI.
set -e
. "$(dirname "$0")/lib/init.sh"

brand_section "Convos identity"

CONVOS_DIR="$HOME/.convos"
IDENTITIES_DIR="$CONVOS_DIR/identities"

# ── XMTP environment ────────────────────────────────────────────────────
_env="${XMTP_ENV:-dev}"
brand_ok "XMTP_ENV" "$_env"

# ── Identity keys on disk ────────────────────────────────────────────────
if [ -d "$IDENTITIES_DIR" ]; then
  _id_count=$(find "$IDENTITIES_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
  if [ "$_id_count" -gt 0 ]; then
    brand_ok "identities" "$_id_count stored in $IDENTITIES_DIR"
  else
    brand_dim "identities" "directory exists but empty"
  fi
else
  brand_dim "identities" "no ~/.convos directory (first-run)"
fi

# ── Convos CLI ───────────────────────────────────────────────────────────
if command -v convos >/dev/null 2>&1; then
  _convos_ver=$(convos --version 2>/dev/null) || _convos_ver="installed"
  brand_ok "convos-cli" "$_convos_ver"
else
  brand_warn "convos-cli" "not found in PATH"
fi

brand_done "Identity check complete"
brand_flush
