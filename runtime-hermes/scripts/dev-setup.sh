#!/bin/bash
set -e

# Local development setup for runtime-hermes.
# Clones hermes-agent, installs all dependencies, and creates a run script.
#
# Usage:
#   ./scripts/dev-setup.sh          # first-time setup
#   ./scripts/dev-run.sh            # start the server (created by this script)

HERMES_TAG="v2026.3.12"
HERMES_DIR="$(cd "$(dirname "$0")/.." && pwd)/.hermes-dev"
RUNTIME_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo ""
echo "  runtime-hermes local dev setup"
echo "  =============================="
echo ""

# ---- Pre-flight checks ----

if ! command -v python3 &>/dev/null; then
  echo "ERROR: python3 is required (3.11+)"
  exit 1
fi

if ! command -v uv &>/dev/null; then
  echo "  Installing uv ..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi

if ! command -v pnpm &>/dev/null; then
  echo "  Installing pnpm ..."
  npm install -g pnpm@9
fi

# ---- .env check ----

if [ ! -f "$RUNTIME_DIR/.env" ]; then
  echo "WARNING: No .env file found. Copy .env.example and fill in your keys:"
  echo "  cp .env.example .env"
  echo ""
fi

# ---- Clone hermes-agent ----

if [ -d "$HERMES_DIR/hermes-agent" ]; then
  echo "  hermes-agent already cloned at $HERMES_DIR/hermes-agent"
else
  echo "  Cloning hermes-agent $HERMES_TAG ..."
  mkdir -p "$HERMES_DIR"
  git clone --recurse-submodules --branch "$HERMES_TAG" --depth 1 \
    https://github.com/NousResearch/hermes-agent.git "$HERMES_DIR/hermes-agent"
fi

# ---- Python deps ----

echo "  Installing hermes-agent Python deps ..."
cd "$HERMES_DIR/hermes-agent"
uv pip install --system -e ".[all]" 2>&1 | tail -1
uv pip install --system -e "./mini-swe-agent" 2>&1 | tail -1

echo "  Installing runtime Python deps ..."
cd "$RUNTIME_DIR"
uv pip install --system --no-cache -r requirements.txt 2>&1 | tail -1

# ---- Node deps (convos-cli) ----

echo "  Installing Node deps (convos-cli) ..."
cd "$RUNTIME_DIR"
pnpm install --no-frozen-lockfile 2>&1 | tail -1

# ---- HERMES_HOME ----

LOCAL_HERMES_HOME="$HERMES_DIR/home"
mkdir -p "$LOCAL_HERMES_HOME/skills" "$LOCAL_HERMES_HOME/memories" "$LOCAL_HERMES_HOME/sessions" "$LOCAL_HERMES_HOME/cron"
if [ ! -f "$LOCAL_HERMES_HOME/SOUL.md" ]; then
  cp "$RUNTIME_DIR/workspace/SOUL.md" "$LOCAL_HERMES_HOME/SOUL.md"
fi

# ---- Create run script ----

cat > "$RUNTIME_DIR/scripts/dev-run.sh" << 'RUNEOF'
#!/bin/bash
set -e

RUNTIME_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HERMES_DIR="$RUNTIME_DIR/.hermes-dev"

# Load .env
if [ -f "$RUNTIME_DIR/.env" ]; then
  set -a
  source "$RUNTIME_DIR/.env"
  set +a
fi

export PYTHONPATH="$HERMES_DIR/hermes-agent:$RUNTIME_DIR:${PYTHONPATH:-}"
export HERMES_HOME="$HERMES_DIR/home"
export NODE_PATH="$RUNTIME_DIR/node_modules"
export PATH="$RUNTIME_DIR/node_modules/.bin:$PATH"
export PORT="${PORT:-8080}"

# Generate gateway token if not set
if [ -z "$OPENCLAW_GATEWAY_TOKEN" ]; then
  export OPENCLAW_GATEWAY_TOKEN=$(python3 -c "import secrets; print(secrets.token_hex(32))")
fi

echo ""
echo "  runtime-hermes (local)"
echo "  ======================"
echo "  HERMES_HOME  -> $HERMES_HOME"
echo "  PYTHONPATH   -> $HERMES_DIR/hermes-agent"
echo "  MODEL        -> ${OPENCLAW_PRIMARY_MODEL:-openrouter/anthropic/claude-sonnet-4-6}"
echo "  PORT         -> $PORT"
echo ""

cd "$RUNTIME_DIR"
exec python3 -m src.main
RUNEOF

chmod +x "$RUNTIME_DIR/scripts/dev-run.sh"

# ---- Done ----

echo ""
echo "  Setup complete!"
echo ""
echo "  To start the server:"
echo "    ./scripts/dev-run.sh"
echo ""
echo "  hermes-agent cloned to: $HERMES_DIR/hermes-agent"
echo "  HERMES_HOME:            $HERMES_DIR/home"
echo ""
