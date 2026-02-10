#!/bin/sh
if [ -n "$BANKR_API_KEY" ]; then
  ROOT="${ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
  BANKR_DIR="${HOME}/.clawdbot/skills/bankr"
  CONFIG="$BANKR_DIR/config.json"
  mkdir -p "$BANKR_DIR"

  if [ -f "$CONFIG" ]; then
    EXISTING=$(jq -r '.privateKey // empty' "$CONFIG" 2>/dev/null)
  else
    EXISTING=""
  fi
  if [ -z "$EXISTING" ]; then
    PRIVATE_KEY="0x$(openssl rand -hex 32)"
  else
    PRIVATE_KEY="$EXISTING"
  fi

  ADDRESS=""
  if [ -f "$ROOT/scripts/derive-eth-address.mjs" ]; then
    ADDRESS=$(cd "$ROOT" && node scripts/derive-eth-address.mjs "$PRIVATE_KEY" 2>/dev/null) || true
  fi
  if [ -z "$ADDRESS" ] && [ -n "$PRIVATE_KEY" ]; then
    echo "[concierge] Bankr: could not derive address from key (config will have no address)"
  fi

  if [ -n "$ADDRESS" ]; then
    jq -n \
      --arg key "$BANKR_API_KEY" \
      --arg pk "$PRIVATE_KEY" \
      --arg addr "$ADDRESS" \
      '{apiKey: $key, apiUrl: "https://api.bankr.bot", privateKey: $pk, address: $addr}' > "$CONFIG"
  else
    jq -n \
      --arg key "$BANKR_API_KEY" \
      --arg pk "$PRIVATE_KEY" \
      '{apiKey: $key, apiUrl: "https://api.bankr.bot", privateKey: $pk}' > "$CONFIG"
  fi
  if [ -z "$EXISTING" ]; then
    echo "[concierge] Bankr: config written to $CONFIG (new wallet key)"
  else
    echo "[concierge] Bankr: config written to $CONFIG (reused existing key)"
  fi

  if [ -z "$EXISTING" ]; then
    ENV_FILE="${ENV_FILE:-$ROOT/.env}"
    touch "$ENV_FILE"
    tmp=$(mktemp)
    found=0
    while IFS= read -r line; do
      case "$line" in
        BANKR_WALLET_PRIVATE_KEY=*) echo "BANKR_WALLET_PRIVATE_KEY=$PRIVATE_KEY"; found=1 ;;
        *) printf '%s\n' "$line" ;;
      esac
    done < "$ENV_FILE" > "$tmp"
    [ "$found" -eq 0 ] && echo "BANKR_WALLET_PRIVATE_KEY=$PRIVATE_KEY" >> "$tmp"
    mv "$tmp" "$ENV_FILE"
    echo "[concierge] Set BANKR_WALLET_PRIVATE_KEY in .env"
  fi
fi
