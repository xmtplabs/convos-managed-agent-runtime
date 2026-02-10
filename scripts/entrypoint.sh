#!/bin/sh
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
. "$ROOT/scripts/env-load.sh"

# Repo has config/ and workspace/; Docker image has config-defaults and workspace-defaults
if [ -d "$ROOT/config-defaults" ]; then CONFIG_DEFAULTS="$ROOT/config-defaults"; else CONFIG_DEFAULTS="$ROOT/config"; fi
if [ -d "$ROOT/workspace-defaults" ]; then WORKSPACE_DEFAULTS="$ROOT/workspace-defaults"; else WORKSPACE_DEFAULTS="$ROOT/workspace"; fi

PORT="${OPENCLAW_PUBLIC_PORT:-${PORT:-8080}}"
STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-$STATE_DIR/workspace}"
CONFIG="$STATE_DIR/openclaw.json"
ENTRY="${OPENCLAW_ENTRY:-/openclaw/dist/entry.js}"

# ---------------------------------------------------------------------------
# Seed config (always overwrite when OPENCLAW_ENTRY set, e.g. dev:local)
# ---------------------------------------------------------------------------
mkdir -p "$STATE_DIR"
if [ -n "$OPENCLAW_ENTRY" ] || [ ! -f "$CONFIG" ]; then
  cp "$CONFIG_DEFAULTS/openclaw.json" "$CONFIG"
  echo "[concierge] Seeded openclaw.json from $CONFIG_DEFAULTS/openclaw.json → $CONFIG"
fi

# ---------------------------------------------------------------------------
# Seed workspace (first run or version bump)
# ---------------------------------------------------------------------------
mkdir -p "$WORKSPACE_DIR"
SHIPPED_VER=$(cat "$WORKSPACE_DEFAULTS/.version" 2>/dev/null || echo 0)
DEPLOYED_VER=$(cat "$WORKSPACE_DIR/.version" 2>/dev/null || echo 0)

if [ ! -f "$WORKSPACE_DIR/SOUL.md" ]; then
  echo "[concierge] First run — seeding workspace from $WORKSPACE_DEFAULTS → $WORKSPACE_DIR"
  cp -r "$WORKSPACE_DEFAULTS/." "$WORKSPACE_DIR/"
else
  if [ "$SHIPPED_VER" -gt "$DEPLOYED_VER" ] 2>/dev/null; then
    echo "[concierge] Workspace version $DEPLOYED_VER → $SHIPPED_VER, updating behavior files"
    for f in SOUL.md AGENTS.md IDENTITY.md TOOLS.md; do
      [ -f "$WORKSPACE_DEFAULTS/$f" ] && cp "$WORKSPACE_DEFAULTS/$f" "$WORKSPACE_DIR/$f"
    done
    [ -d "$WORKSPACE_DEFAULTS/skills" ] && cp -r "$WORKSPACE_DEFAULTS/skills" "$WORKSPACE_DIR/"
    [ -f "$WORKSPACE_DEFAULTS/.version" ] && cp "$WORKSPACE_DEFAULTS/.version" "$WORKSPACE_DIR/.version"
    echo "[concierge] Updated SOUL.md AGENTS.md IDENTITY.md TOOLS.md and skills/"
  else
    echo "[concierge] Workspace up to date (v$DEPLOYED_VER)"
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
# Patch config (port, bind, token, plugins path)
# ---------------------------------------------------------------------------
jq --arg port "$PORT" --arg token "$TOKEN" \
  '.gateway.port = ($port | tonumber) | .gateway.bind = "lan" | .gateway.auth = ((.gateway.auth // {}) | .mode = "token" | .token = $token)' \
  "$CONFIG" > "$CONFIG.tmp" && mv "$CONFIG.tmp" "$CONFIG"

# Plugin paths: only add custom dir (absolute). Bundled plugins are discovered by OpenClaw from its install; adding bundled dir here causes duplicate plugin id warnings.
CUSTOM_PLUGINS_ABS=""
if [ -n "$OPENCLAW_CUSTOM_PLUGINS_DIR" ] && [ -d "$OPENCLAW_CUSTOM_PLUGINS_DIR" ]; then
  CUSTOM_PLUGINS_ABS="$(cd "$OPENCLAW_CUSTOM_PLUGINS_DIR" && pwd)"
  for ext in "$CUSTOM_PLUGINS_ABS"/*/; do
    [ -f "${ext}package.json" ] && (cd "$ext" && pnpm install 2>/dev/null || true)
  done
  jq --arg d "$CUSTOM_PLUGINS_ABS" \
    '.plugins = ((.plugins // {}) | .load = ((.load // {}) | .paths = (([$d] + (.paths // [])))))' \
    "$CONFIG" > "$CONFIG.tmp" && mv "$CONFIG.tmp" "$CONFIG"
  echo "[concierge] Plugins path: $CUSTOM_PLUGINS_ABS"
fi

echo "[concierge] Patched config: gateway.port=$PORT, gateway.bind=lan"

# ---------------------------------------------------------------------------
# Skill setup (merge .env keys into skills.entries, etc.)
# ---------------------------------------------------------------------------
if [ -x "$ROOT/scripts/skill-setup.sh" ]; then
  ROOT="$ROOT" OPENCLAW_STATE_DIR="$STATE_DIR" "$ROOT/scripts/skill-setup.sh"
  echo "[concierge] Ran skill setup"
fi

# ---------------------------------------------------------------------------
# Env for gateway
# ---------------------------------------------------------------------------
export OPENCLAW_STATE_DIR="$STATE_DIR"
export OPENCLAW_WORKSPACE_DIR="$WORKSPACE_DIR"
export OPENCLAW_CONFIG_PATH="$CONFIG"

# ---------------------------------------------------------------------------
# Kill previous instance (same port or openclaw gateway lock)
# ---------------------------------------------------------------------------
if command -v node >/dev/null 2>&1 && [ -n "$ENTRY" ] && [ -r "$ENTRY" ]; then
  node "$ENTRY" gateway stop 2>/dev/null || true
fi
PID=$(lsof -ti "tcp:$PORT" 2>/dev/null) || true
if [ -n "$PID" ]; then
  echo "[concierge] Killing previous process on port $PORT (pid $PID)"
  kill -9 $PID 2>/dev/null || true
fi

if [ -n "$OPENCLAW_ENTRY" ] && [ ! -r "$ENTRY" ]; then
  echo "[concierge] OpenClaw not found at $ENTRY. Run: pnpm run upgrade:openclaw"
  exit 1
fi
echo "[concierge] Starting gateway: port=$PORT state_dir=$STATE_DIR"
if [ -n "$OPENCLAW_ENTRY" ]; then
  echo "[concierge] Open (with token): http://127.0.0.1:$PORT/setup/chat?session=main&token=$TOKEN"
fi
exec node "$ENTRY" gateway run --bind 0.0.0.0 --port "$PORT" --auth token --token "$TOKEN"
