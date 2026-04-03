#!/bin/sh
# Check Convos identity status before gateway launch.
# Validates credentials file, identity keys, and XMTP environment.
set -e

. "$(dirname "$0")/init.sh"

brand_section "Identity"
brand_dim "" "verify XMTP credentials and Convos CLI"

CREDS_FILE="$STATE_DIR/credentials/convos-identity.json"

# ── XMTP environment ─────────────────────────────────────────────────────
_env="${XMTP_ENV:-}"
if [ -z "$_env" ]; then
  # Fall back to config file
  if command -v jq >/dev/null 2>&1 && [ -f "$CONFIG" ]; then
    _env=$(jq -r '.channels.convos.env // empty' "$CONFIG" 2>/dev/null) || true
  fi
fi
if [ -n "$_env" ]; then
  brand_ok "XMTP_ENV" "$_env"
else
  brand_dim "XMTP_ENV" "not set (will use CLI default)"
fi

# ── Credentials file (openclaw-specific) ──────────────────────────────────
if [ -f "$CREDS_FILE" ]; then
  if command -v jq >/dev/null 2>&1; then
    _identity_id=$(jq -r '.identityId // empty' "$CREDS_FILE" 2>/dev/null) || true
    _conversation_id=$(jq -r '.ownerConversationId // empty' "$CREDS_FILE" 2>/dev/null) || true

    if [ -n "$_identity_id" ]; then
      brand_ok "identityId" "$_identity_id"
    else
      brand_warn "identityId" "missing from credentials"
    fi

    if [ -n "$_conversation_id" ]; then
      brand_ok "conversationId" "$_conversation_id"
    else
      brand_warn "conversationId" "missing from credentials"
    fi
  else
    brand_ok "credentials" "$CREDS_FILE"
  fi
else
  brand_dim "credentials" "not found (first-run — will create on setup)"
fi

# ── Identity keys + CLI (shared) ──────────────────────────────────────────
. "$LIB_DIR/identity-check.sh"
check_identity_keys
check_convos_cli

brand_done "Identity check complete"
brand_flush
