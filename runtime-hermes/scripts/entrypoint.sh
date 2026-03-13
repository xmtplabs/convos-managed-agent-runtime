#!/bin/sh
set -e

echo ""
echo "  convos-runtime-hermes"
echo "  ====================="
echo ""

export CONVOS_REPO_ROOT="/app"

# Validate required env vars
if [ -z "$OPENROUTER_API_KEY" ]; then
  echo "  ERROR: OPENROUTER_API_KEY is required but not set" >&2
  exit 1
fi

# Persistent volume — redirect HERMES_HOME if Railway volume is mounted.
# This gives persistent memory, skills, sessions, and cron across restarts.
if [ -n "$RAILWAY_VOLUME_MOUNT_PATH" ]; then
  export HERMES_HOME="${RAILWAY_VOLUME_MOUNT_PATH}/hermes"
  mkdir -p "$HERMES_HOME/skills" "$HERMES_HOME/memories" "$HERMES_HOME/sessions" "$HERMES_HOME/cron"
  # Seed SOUL.md from the image if not already on the volume
  [ ! -f "$HERMES_HOME/SOUL.md" ] && cp /app/.hermes/SOUL.md "$HERMES_HOME/SOUL.md"
  [ ! -f "$HERMES_HOME/config.yaml" ] && cp /app/.hermes/config.yaml "$HERMES_HOME/config.yaml"
  for skill_dir in /app/.hermes/skills/*; do
    [ -d "$skill_dir" ] || continue
    skill_name="$(basename "$skill_dir")"
    rm -rf "$HERMES_HOME/skills/$skill_name"
    cp -R "$skill_dir" "$HERMES_HOME/skills/$skill_name"
  done
  echo "  HERMES_HOME      -> $HERMES_HOME (volume-backed)"
else
  echo "  HERMES_HOME      -> ${HERMES_HOME:-/app/.hermes} (ephemeral)"
fi

# Generate gateway token if not provided
if [ -z "$OPENCLAW_GATEWAY_TOKEN" ]; then
  export OPENCLAW_GATEWAY_TOKEN=$(python3 -c "import secrets; print(secrets.token_hex(32))")
  echo "  GATEWAY_TOKEN    -> generated"
else
  echo "  GATEWAY_TOKEN    -> from env"
fi

echo "  MODEL            -> ${OPENCLAW_PRIMARY_MODEL:-openrouter/anthropic/claude-sonnet-4-6}"
echo "  XMTP_ENV         -> ${XMTP_ENV:-dev}"
echo "  PORT             -> ${PORT:-8080}"
[ -n "$POOL_URL" ] && echo "  POOL_URL         -> $POOL_URL" || echo "  POOL_URL         -> not set"
[ -n "$INSTANCE_ID" ] && echo "  INSTANCE_ID      -> $INSTANCE_ID" || echo "  INSTANCE_ID      -> not set"
echo ""

exec "$@"
