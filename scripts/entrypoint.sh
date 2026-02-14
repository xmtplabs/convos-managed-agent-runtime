#!/bin/sh
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
. "$ROOT/scripts/env-load.sh"

# Artifact paths: tenant overlay (config) and agent Brain (workspace) seeds.
# Docker image may use config-defaults / workspace-defaults; repo uses config/ and workspace/.
if [ -d "$ROOT/config-defaults" ]; then CONFIG_DEFAULTS="$ROOT/config-defaults"; else CONFIG_DEFAULTS="$ROOT/config"; fi
if [ -d "$ROOT/workspace-defaults" ]; then WORKSPACE_DEFAULTS="$ROOT/workspace-defaults"; else WORKSPACE_DEFAULTS="$ROOT/workspace"; fi

PORT="${OPENCLAW_PUBLIC_PORT:-${PORT:-18789}}"
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
  echo "[agent] Tenant overlay: seeded config from $CONFIG_DEFAULTS → $CONFIG"
else
  echo "[agent] Tenant overlay: config already exists at $CONFIG (kept)"
fi

# ---------------------------------------------------------------------------
# agent Brain: seed workspace (AGENTS.md, SOUL.md, TOOLS.md, skills) by version
# ---------------------------------------------------------------------------
mkdir -p "$WORKSPACE_DIR"
PACK_SHIPPED_VER=$(jq -r .version "$ROOT/package.json" 2>/dev/null || echo "0.0.0")
PACK_DEPLOYED_VER=$(cat "$WORKSPACE_DIR/.deployed-version" 2>/dev/null || echo "0.0.0")
NEED_UPGRADE=false
if [ "$PACK_SHIPPED_VER" != "$PACK_DEPLOYED_VER" ]; then
  HIGHER=$(printf '%s\n%s' "$PACK_SHIPPED_VER" "$PACK_DEPLOYED_VER" | sort -V | tail -1)
  [ "$HIGHER" = "$PACK_SHIPPED_VER" ] && NEED_UPGRADE=true
fi

if [ ! -f "$WORKSPACE_DIR/SOUL.md" ]; then
  echo "[agent] agent Brain: first run, seeding workspace from $WORKSPACE_DEFAULTS → $WORKSPACE_DIR"
  cp -r "$WORKSPACE_DEFAULTS/." "$WORKSPACE_DIR/"
  echo "$PACK_SHIPPED_VER" > "$WORKSPACE_DIR/.deployed-version"
else
  if [ "$NEED_UPGRADE" = true ]; then
    echo "[agent] agent Brain: v$PACK_DEPLOYED_VER → v$PACK_SHIPPED_VER, updating behavior files"
    for f in SOUL.md AGENTS.md IDENTITY.md TOOLS.md; do
      [ -f "$WORKSPACE_DEFAULTS/$f" ] && cp "$WORKSPACE_DEFAULTS/$f" "$WORKSPACE_DIR/$f"
    done
    [ -d "$WORKSPACE_DEFAULTS/skills" ] && cp -r "$WORKSPACE_DEFAULTS/skills" "$WORKSPACE_DIR/"
    [ -d "$WORKSPACE_DEFAULTS/memory" ] && mkdir -p "$WORKSPACE_DIR/memory" && [ -f "$WORKSPACE_DEFAULTS/memory/.gitkeep" ] && cp "$WORKSPACE_DEFAULTS/memory/.gitkeep" "$WORKSPACE_DIR/memory/"
    echo "$PACK_SHIPPED_VER" > "$WORKSPACE_DIR/.deployed-version"
    echo "[agent] agent Brain: updated SOUL.md AGENTS.md IDENTITY.md TOOLS.md and skills/"
  else
    echo "[agent] agent Brain: workspace up to date (v$PACK_DEPLOYED_VER)"
  fi
fi

# ---------------------------------------------------------------------------
# Gateway token and setup password
# ---------------------------------------------------------------------------
if [ -n "$OPENCLAW_GATEWAY_TOKEN" ]; then
  TOKEN="$OPENCLAW_GATEWAY_TOKEN"
  echo "[agent] Token from OPENCLAW_GATEWAY_TOKEN"
elif [ -f "$STATE_DIR/gateway.token" ]; then
  TOKEN=$(cat "$STATE_DIR/gateway.token")
  echo "[agent] Token from gateway.token"
else
  TOKEN=$(openssl rand -hex 32)
  mkdir -p "$STATE_DIR"
  echo "$TOKEN" > "$STATE_DIR/gateway.token"
  chmod 600 "$STATE_DIR/gateway.token"
  echo "[agent] Token generated"
fi
export OPENCLAW_GATEWAY_TOKEN="$TOKEN"
export SETUP_password="${SETUP_password:-$SETUP_PASSWORD}"

# ---------------------------------------------------------------------------
# Runtime: patch tenant config (port, bind, token) and load runtime plugin path
# ---------------------------------------------------------------------------
jq --arg port "$PORT" --arg token "$TOKEN" --arg workspace "$WORKSPACE_DIR" \
  '.gateway.port = ($port | tonumber) | .gateway.bind = "lan" | .gateway.auth = ((.gateway.auth // {}) | .mode = "token" | .token = $token) | .agents.defaults.workspace = $workspace' \
  "$CONFIG" > "$CONFIG.tmp" && mv "$CONFIG.tmp" "$CONFIG"

# Verify final config state
_skip=$(jq -r '.agents.defaults.skipBootstrap // "unset"' "$CONFIG")
_ws=$(jq -r '.agents.defaults.workspace // "unset"' "$CONFIG")
_subs=$(jq -r '[.agents.list[]? | "\(.id)(\(.workspace // "inherit"))"] | join(", ")' "$CONFIG")
echo "[agent] Config verify: skipBootstrap=$_skip workspace=$_ws"
echo "[agent] Config verify: subagents=$_subs"

# Runtime artifact: custom plugins dir (extensions/convos); bundled plugins from OpenClaw install.
# Ensure extension node_modules exist before OpenClaw loads plugins.
if [ -x "$ROOT/scripts/install-extension-deps.sh" ]; then
  ROOT="$ROOT" OPENCLAW_CUSTOM_PLUGINS_DIR="${OPENCLAW_CUSTOM_PLUGINS_DIR:-$ROOT/extensions}" "$ROOT/scripts/install-extension-deps.sh"
fi

RUNTIME_PLUGINS_ABS=""
if [ -n "$OPENCLAW_CUSTOM_PLUGINS_DIR" ] && [ -d "$OPENCLAW_CUSTOM_PLUGINS_DIR" ]; then
  RUNTIME_PLUGINS_ABS="$(cd "$OPENCLAW_CUSTOM_PLUGINS_DIR" && pwd)"
  jq --arg d "$RUNTIME_PLUGINS_ABS" \
    '.plugins = ((.plugins // {}) | .load = ((.load // {}) | .paths = (([$d] + (.paths // [])))))' \
    "$CONFIG" > "$CONFIG.tmp" && mv "$CONFIG.tmp" "$CONFIG"
  echo "[agent] Runtime: plugins path $RUNTIME_PLUGINS_ABS"
fi

echo "[agent] Runtime: gateway.port=$PORT, gateway.bind=lan"

# ---------------------------------------------------------------------------
# OpenRouter: create or reuse per-deployment API key (if OPENROUTER_MANAGEMENT_KEY set)
# ---------------------------------------------------------------------------
if [ -x "$ROOT/scripts/openrouter-ensure-key.sh" ]; then
  eval "$(STATE_DIR="$STATE_DIR" OPENCLAW_STATE_DIR="$STATE_DIR" "$ROOT/scripts/openrouter-ensure-key.sh")"
fi

# ---------------------------------------------------------------------------
# Skill setup (merge .env keys into skills.entries, etc.)
# ---------------------------------------------------------------------------
if [ -x "$ROOT/scripts/skill-setup.sh" ]; then
  ROOT="$ROOT" OPENCLAW_STATE_DIR="$STATE_DIR" "$ROOT/scripts/skill-setup.sh"
  echo "[agent] Ran skill setup"
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
  echo "[agent] Killing previous process on port $PORT (pid $PID)"
  kill -9 $PID 2>/dev/null || true
fi

# ---------------------------------------------------------------------------
# Inject runtime version into agent context (AGENTS.md)
# ---------------------------------------------------------------------------
agent_VER=$(jq -r .version "$ROOT/package.json" 2>/dev/null || echo "?")
if [ -f "$WORKSPACE_DIR/AGENTS.md" ]; then
  sed "s/{{VERSION}}/$agent_VER/g" "$WORKSPACE_DIR/AGENTS.md" > "$WORKSPACE_DIR/AGENTS.md.tmp" && mv "$WORKSPACE_DIR/AGENTS.md.tmp" "$WORKSPACE_DIR/AGENTS.md"
fi
echo "[agent] agent v$agent_VER"
echo "[agent] Runtime: starting gateway port=$PORT state_dir=$STATE_DIR"
echo "[agent] Open (with token): http://127.0.0.1:$PORT/setup/chat?session=main&token=$TOKEN"
exec $ENTRY gateway run --bind 0.0.0.0 --port "$PORT" --auth token --token "$TOKEN"
