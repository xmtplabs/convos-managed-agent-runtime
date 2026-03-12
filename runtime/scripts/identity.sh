#!/bin/sh
# Check Convos identity status before gateway launch.
# Validates credentials file, identity keys, and XMTP environment.
set -e

. "$(dirname "$0")/lib/init.sh"
. "$ROOT/scripts/lib/env-load.sh"
. "$ROOT/scripts/lib/brand.sh"

brand_section "Convos identity"

CREDS_FILE="$STATE_DIR/credentials/convos-identity.json"
CONVOS_DIR="$HOME/.convos"
IDENTITIES_DIR="$CONVOS_DIR/identities"

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

# ── Credentials file ─────────────────────────────────────────────────────
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

# ── Identity keys on disk ────────────────────────────────────────────────
if [ -d "$IDENTITIES_DIR" ]; then
  _id_count=$(find "$IDENTITIES_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
  if [ "$_id_count" -gt 0 ]; then
    brand_ok "identities" "$_id_count stored in $IDENTITIES_DIR"
  else
    brand_dim "identities" "directory exists but empty"
  fi
elif [ -L "$CONVOS_DIR" ]; then
  # Railway volume symlink
  _target=$(readlink "$CONVOS_DIR" 2>/dev/null) || true
  if [ -d "$_target/identities" ]; then
    _id_count=$(find "$_target/identities" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
    brand_ok "identities" "$_id_count stored via volume symlink → $_target"
  else
    brand_dim "identities" "volume symlink exists but no identities yet"
  fi
else
  brand_dim "identities" "no ~/.convos directory (first-run)"
fi

# ── Convos CLI availability ──────────────────────────────────────────────
if command -v convos >/dev/null 2>&1; then
  _convos_ver=$(convos --version 2>/dev/null) || _convos_ver="installed"
  brand_ok "convos-cli" "$_convos_ver"
else
  brand_warn "convos-cli" "not found in PATH"
fi

brand_done "Identity check complete"
brand_flush
