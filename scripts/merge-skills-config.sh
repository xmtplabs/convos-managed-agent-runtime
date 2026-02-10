#!/bin/sh
# Merge .env skill keys into ~/.openclaw/openclaw.json skills.entries
# Run after config seed, or via task skill-setup.
set -e
ROOT="${ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
CONFIG="$STATE_DIR/openclaw.json"
if [ -f "$CONFIG" ] && [ -f "$ENV_FILE" ]; then
  get_key() {
    grep -E "^${1}=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- | sed 's/^["'\'' ]*//;s/["'\'' ]*$//' | head -1
  }
  BANKR_KEY="$(get_key BANKR_API_KEY)"
  AGENTMAIL_KEY="$(get_key AGENTMAIL_API_KEY)"
  if [ -n "$BANKR_KEY" ]; then
    jq --arg k "$BANKR_KEY" '.skills.entries.bankr.apiKey = $k' "$CONFIG" > "$CONFIG.tmp" && mv "$CONFIG.tmp" "$CONFIG"
    echo "[concierge] Set skills.entries.bankr.apiKey from .env"
  fi
  if [ -n "$AGENTMAIL_KEY" ]; then
    jq --arg k "$AGENTMAIL_KEY" '.skills.entries.agentmail.apiKey = $k' "$CONFIG" > "$CONFIG.tmp" && mv "$CONFIG.tmp" "$CONFIG"
    echo "[concierge] Set skills.entries.agentmail.apiKey from .env"
  fi
fi
