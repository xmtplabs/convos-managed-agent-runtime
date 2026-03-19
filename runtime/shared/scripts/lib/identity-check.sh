#!/bin/sh
# Shared Convos identity checks (keys on disk + CLI availability).
# Requires: brand helpers loaded.

check_identity_keys() {
  CONVOS_DIR="$HOME/.convos"
  IDENTITIES_DIR="$CONVOS_DIR/identities"

  if [ -d "$IDENTITIES_DIR" ]; then
    _id_count=$(find "$IDENTITIES_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
    if [ "$_id_count" -gt 0 ]; then
      brand_ok "identities" "$_id_count stored in $IDENTITIES_DIR"
    else
      brand_dim "identities" "directory exists but empty"
    fi
  elif [ -L "$CONVOS_DIR" ]; then
    _target=$(readlink "$CONVOS_DIR" 2>/dev/null) || true
    if [ -d "$_target/identities" ]; then
      _id_count=$(find "$_target/identities" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
      brand_ok "identities" "$_id_count stored via volume symlink -> $_target"
    else
      brand_dim "identities" "volume symlink exists but no identities yet"
    fi
  else
    brand_dim "identities" "no ~/.convos directory (first-run)"
  fi
}

check_convos_cli() {
  if command -v convos >/dev/null 2>&1; then
    _convos_ver=$(convos --version 2>/dev/null) || _convos_ver="installed"
    brand_ok "convos-cli" "$_convos_ver"
  else
    brand_warn "convos-cli" "not found in PATH"
  fi
}
