#!/bin/sh
# If OPENROUTER_MANAGEMENT_KEY is set, ensure OPENROUTER_API_KEY is set for this deployment.
# Outputs: export OPENROUTER_API_KEY='...' for eval by the caller.
set -e

STATE_DIR="${OPENCLAW_STATE_DIR:-$STATE_DIR}"
KEYFILE="${STATE_DIR}/openrouter.key"

if [ -n "$OPENROUTER_API_KEY" ]; then
  printf "export OPENROUTER_API_KEY='%s'\n" "$(echo "$OPENROUTER_API_KEY" | sed "s/'/'\\\\''/g")"
  exit 0
fi

if [ -z "$OPENROUTER_MANAGEMENT_KEY" ]; then
  exit 0
fi

if [ -z "$STATE_DIR" ]; then
  echo "[openrouter] STATE_DIR not set, skipping key ensure" >&2
  exit 0
fi

if [ -f "$KEYFILE" ]; then
  key=$(cat "$KEYFILE")
  printf "export OPENROUTER_API_KEY='%s'\n" "$(echo "$key" | sed "s/'/'\\\\''/g")"
  echo "[openrouter] Using existing key from $KEYFILE" >&2
  exit 0
fi

name="${OPENROUTER_KEY_NAME_PREFIX:-convos}-${HOSTNAME}-$(date +%s)"
limit="${OPENROUTER_KEY_LIMIT:-20}"
limit_reset="${OPENROUTER_KEY_LIMIT_RESET:-monthly}"

payload=$(jq -n --arg name "$name" --arg limit "$limit" --arg limit_reset "$limit_reset" \
  '{name: $name, limit: ($limit | tonumber), limit_reset: $limit_reset}')
resp=$(curl -s -w '\n%{http_code}' -X POST "https://openrouter.ai/api/v1/keys" \
  -H "Authorization: Bearer $OPENROUTER_MANAGEMENT_KEY" \
  -H "Content-Type: application/json" \
  -d "$payload")

http_code=$(echo "$resp" | tail -n1)
body=$(echo "$resp" | sed '$d')

key=$(echo "$body" | jq -r '.key // empty')
if [ -z "$key" ] || [ "$key" = "null" ]; then
  echo "[openrouter] Failed to create key (http=$http_code): $body" >&2
  exit 1
fi

mkdir -p "$STATE_DIR"
echo "$key" > "$KEYFILE"
chmod 600 "$KEYFILE"
printf "export OPENROUTER_API_KEY='%s'\n" "$(echo "$key" | sed "s/'/'\\\\''/g")"
echo "[openrouter] Created key and saved to $KEYFILE" >&2
