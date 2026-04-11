#!/bin/sh
# Clear Convos XMTP identity so the next start creates a fresh one.
# Called via `pnpm start:new`.
set -e

CONVOS_HOME="${HOME}/.convos"

echo "[new-identity] Clearing XMTP identity..."

# Clear XMTP CLI identity + db
for entry in identities db; do
  target="$CONVOS_HOME/$entry"
  if [ -d "$target" ]; then
    rm -rf "$target"
    echo "[new-identity] Removed $target"
  fi
done

# Clear runtime credentials (both openclaw and hermes)
_script_dir="$(cd "$(dirname "$0")" && pwd)"
_runtime_dir="$(dirname "$_script_dir")"

# OpenClaw: $STATE_DIR/credentials/convos-identity.json
_oc_creds="$_runtime_dir/openclaw/.openclaw-dev/credentials/convos-identity.json"
if [ -f "$_oc_creds" ]; then
  rm -f "$_oc_creds"
  echo "[new-identity] Removed openclaw credentials"
fi

# Hermes: $HERMES_HOME/credentials/convos-identity.json
_hm_creds="$_runtime_dir/hermes/.hermes-dev/home/credentials/convos-identity.json"
if [ -f "$_hm_creds" ]; then
  rm -f "$_hm_creds"
  echo "[new-identity] Removed hermes credentials"
fi

echo "[new-identity] Identity cleared — a fresh one will be created on start."
