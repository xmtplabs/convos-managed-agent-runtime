#!/bin/sh
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
. "$ROOT/scripts/env-load.sh"

# Artifact paths: tenant overlay (config) and Concierge Brain (workspace) seeds.
# Docker image may use config-defaults / workspace-defaults; repo uses config/ and workspace/.
if [ -d "$ROOT/config-defaults" ]; then CONFIG_DEFAULTS="$ROOT/config-defaults"; else CONFIG_DEFAULTS="$ROOT/config"; fi
if [ -d "$ROOT/workspace-defaults" ]; then WORKSPACE_DEFAULTS="$ROOT/workspace-defaults"; else WORKSPACE_DEFAULTS="$ROOT/workspace"; fi

PORT="${OPENCLAW_PUBLIC_PORT:-${PORT:-8080}}"
STATE_DIR="${OPENCLAW_STATE_DIR:-${RAILWAY_VOLUME_MOUNT_PATH:-$HOME/.openclaw}}"
WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-$STATE_DIR/workspace}"
CONFIG="$STATE_DIR/openclaw.json"
ENTRY="${OPENCLAW_ENTRY:-$(command -v openclaw 2>/dev/null || echo npx openclaw)}"

# ---------------------------------------------------------------------------
# Tenant overlay: seed openclaw.json (credentials, identity, channel routing)
# ---------------------------------------------------------------------------
mkdir -p "$STATE_DIR"
if [ ! -f "$CONFIG" ]; then
  cp "$CONFIG_DEFAULTS/openclaw.json" "$CONFIG"
  echo "[concierge] Tenant overlay: seeded config from $CONFIG_DEFAULTS → $CONFIG"
else
  echo "[concierge] Tenant overlay: config already exists at $CONFIG (kept)"
fi

# ---------------------------------------------------------------------------
# Concierge Brain: seed workspace (AGENTS.md, SOUL.md, TOOLS.md, skills) by version
# ---------------------------------------------------------------------------
mkdir -p "$WORKSPACE_DIR"
PACK_SHIPPED_VER=$(cat "$WORKSPACE_DEFAULTS/.version" 2>/dev/null || echo 0)
PACK_DEPLOYED_VER=$(cat "$WORKSPACE_DIR/.version" 2>/dev/null || echo 0)

if [ ! -f "$WORKSPACE_DIR/SOUL.md" ]; then
  echo "[concierge] Concierge Brain: first run, seeding workspace from $WORKSPACE_DEFAULTS → $WORKSPACE_DIR"
  cp -r "$WORKSPACE_DEFAULTS/." "$WORKSPACE_DIR/"
else
  if [ "$PACK_SHIPPED_VER" -gt "$PACK_DEPLOYED_VER" ] 2>/dev/null; then
    echo "[concierge] Concierge Brain: v$PACK_DEPLOYED_VER → v$PACK_SHIPPED_VER, updating behavior files"
    for f in SOUL.md AGENTS.md IDENTITY.md TOOLS.md; do
      [ -f "$WORKSPACE_DEFAULTS/$f" ] && cp "$WORKSPACE_DEFAULTS/$f" "$WORKSPACE_DIR/$f"
    done
    [ -d "$WORKSPACE_DEFAULTS/skills" ] && cp -r "$WORKSPACE_DEFAULTS/skills" "$WORKSPACE_DIR/"
    [ -f "$WORKSPACE_DEFAULTS/.version" ] && cp "$WORKSPACE_DEFAULTS/.version" "$WORKSPACE_DIR/.version"
    echo "[concierge] Concierge Brain: updated SOUL.md AGENTS.md IDENTITY.md TOOLS.md and skills/"
  else
    echo "[concierge] Concierge Brain: workspace up to date (v$PACK_DEPLOYED_VER)"
  fi
fi

# ---------------------------------------------------------------------------
# Gateway token and setup password (default "test" for dev)
# ---------------------------------------------------------------------------
if [ -n "$OPENCLAW_GATEWAY_TOKEN" ]; then
  TOKEN="$OPENCLAW_GATEWAY_TOKEN"
  echo "[concierge] Token from OPENCLAW_GATEWAY_TOKEN"
elif [ -n "$OPENCLAW_ENTRY" ]; then
  TOKEN="test"
  echo "[concierge] Token: test (dev)"
elif [ -f "$STATE_DIR/gateway.token" ]; then
  TOKEN=$(cat "$STATE_DIR/gateway.token")
  echo "[concierge] Token from gateway.token"
else
  TOKEN=$(openssl rand -hex 32)
  mkdir -p "$STATE_DIR"
  echo "$TOKEN" > "$STATE_DIR/gateway.token"
  chmod 600 "$STATE_DIR/gateway.token"
  echo "[concierge] Token generated"
fi
export OPENCLAW_GATEWAY_TOKEN="$TOKEN"
export SETUP_password="${SETUP_password:-test}"

# ---------------------------------------------------------------------------
# Runtime: patch tenant config (port, bind, token) and load runtime plugin path
# ---------------------------------------------------------------------------
jq --arg port "$PORT" --arg token "$TOKEN" \
  '.gateway.port = ($port | tonumber) | .gateway.bind = "lan" | .gateway.auth = ((.gateway.auth // {}) | .mode = "token" | .token = $token)' \
  "$CONFIG" > "$CONFIG.tmp" && mv "$CONFIG.tmp" "$CONFIG"

# Runtime artifact: custom plugins dir (extensions/convos); bundled plugins from OpenClaw install.
RUNTIME_PLUGINS_ABS=""
if [ -n "$OPENCLAW_CUSTOM_PLUGINS_DIR" ] && [ -d "$OPENCLAW_CUSTOM_PLUGINS_DIR" ]; then
  RUNTIME_PLUGINS_ABS="$(cd "$OPENCLAW_CUSTOM_PLUGINS_DIR" && pwd)"
  for ext in "$RUNTIME_PLUGINS_ABS"/*/; do
    [ -f "${ext}package.json" ] && (cd "$ext" && pnpm install 2>/dev/null || true)
  done
  jq --arg d "$RUNTIME_PLUGINS_ABS" \
    '.plugins = ((.plugins // {}) | .load = ((.load // {}) | .paths = (([$d] + (.paths // [])))))' \
    "$CONFIG" > "$CONFIG.tmp" && mv "$CONFIG.tmp" "$CONFIG"
  echo "[concierge] Runtime: plugins path $RUNTIME_PLUGINS_ABS"
fi

echo "[concierge] Runtime: gateway.port=$PORT, gateway.bind=lan"

# ---------------------------------------------------------------------------
# Skill setup (merge .env keys into skills.entries, etc.)
# ---------------------------------------------------------------------------
if [ -x "$ROOT/scripts/skill-setup.sh" ]; then
  ROOT="$ROOT" OPENCLAW_STATE_DIR="$STATE_DIR" "$ROOT/scripts/skill-setup.sh"
  echo "[concierge] Ran skill setup"
fi

# ---------------------------------------------------------------------------
# Env for gateway (NODE_PATH so exec can require skill deps e.g. agentmail)
# ---------------------------------------------------------------------------
export OPENCLAW_STATE_DIR="$STATE_DIR"
export OPENCLAW_WORKSPACE_DIR="$WORKSPACE_DIR"
export OPENCLAW_CONFIG_PATH="$CONFIG"
if [ -d "$ROOT/node_modules" ]; then
  export NODE_PATH="$ROOT/node_modules${NODE_PATH:+:$NODE_PATH}"
fi

# ---------------------------------------------------------------------------
# Kill previous instance (same port or openclaw gateway lock)
# ---------------------------------------------------------------------------
$ENTRY gateway stop 2>/dev/null || true
PID=$(lsof -ti "tcp:$PORT" 2>/dev/null) || true
if [ -n "$PID" ]; then
  echo "[concierge] Killing previous process on port $PORT (pid $PID)"
  kill -9 $PID 2>/dev/null || true
fi

CONCIERGE_VER=$(jq -r .version "$ROOT/package.json" 2>/dev/null || echo "?")
echo "[concierge] Concierge v$CONCIERGE_VER"
echo "[concierge] Runtime: starting gateway port=$PORT state_dir=$STATE_DIR"
echo "[concierge] Open (with token): http://127.0.0.1:$PORT/setup/chat?session=main&token=$TOKEN"
exec $ENTRY gateway run --bind 0.0.0.0 --port "$PORT" --auth token --token "$TOKEN"
