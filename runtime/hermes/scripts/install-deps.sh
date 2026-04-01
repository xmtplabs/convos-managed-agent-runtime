#!/bin/sh
# Bootstrap hermes-agent (first run) and ensure all deps are installed.
set -e
. "$(dirname "$0")/init.sh"

HERMES_TAG="v2026.3.30"

brand_section "Dependencies"
brand_dim "" "install extensions and check toolchain"

# ── Pip target — Docker uses system Python; macOS needs a venv (PEP 668) ─
if is_docker; then
  PIP_TARGET="--system"
else
  VENV_DIR="$ROOT/.hermes-dev/venv"
  VENV_PYTHON="$VENV_DIR/bin/python"
  PIP_TARGET="--python $VENV_PYTHON"
  brand_subsection "venv"
  if [ ! -f "$VENV_PYTHON" ]; then
    brand_info "venv" "creating at $VENV_DIR ..."
    uv venv "$VENV_DIR" --python 3.11
    brand_ok "venv" "created"
  else
    brand_ok "venv" "$VENV_DIR"
  fi
fi

# ── Hermes agent (local dev only — Docker pre-installs to /opt) ──────────
brand_subsection "hermes-agent"
INSTALLED_TAG=$(cd "$HERMES_AGENT_DIR" 2>/dev/null && git describe --tags --exact-match 2>/dev/null || true)
if is_docker; then
  brand_ok "hermes-agent" "$HERMES_TAG (pre-installed)"
elif [ "$INSTALLED_TAG" = "$HERMES_TAG" ]; then
  brand_ok "hermes-agent" "$HERMES_TAG"
else
  [ -n "$INSTALLED_TAG" ] && brand_info "hermes-agent" "$INSTALLED_TAG → $HERMES_TAG"
  rm -rf "$HERMES_AGENT_DIR"
  mkdir -p "$(dirname "$HERMES_AGENT_DIR")"
  git clone --recurse-submodules --branch "$HERMES_TAG" --depth 1 \
    https://github.com/NousResearch/hermes-agent.git "$HERMES_AGENT_DIR"
  cd "$HERMES_AGENT_DIR"
  uv pip install $PIP_TARGET ".[cron,mcp,pty,homeassistant]"
  cd "$ROOT"
  brand_ok "hermes-agent" "$HERMES_TAG (installed)"
fi

# Runtime Python deps — always reconcile (fast no-op if unchanged)
brand_info "runtime" "syncing Python deps ..."
uv pip install $PIP_TARGET --no-cache -r "$ROOT/requirements.txt"

# ── Node deps (local dev only — Docker pre-installs) ────────────────────
brand_subsection "node"
if [ ! -d "$ROOT/node_modules/.bin" ]; then
  brand_info "node deps" "installing ..."
  cd "$ROOT" && CI=true pnpm install --frozen-lockfile
  cd "$ROOT"
  brand_ok "node deps" "installed"
else
  brand_ok "node deps" "present"
fi

# ── Toolchain versions ──────────────────────────────────────────────────
brand_subsection "toolchain"
convos_ver=$(convos --version 2>/dev/null || echo "not found")
node_ver=$(node --version 2>/dev/null || echo "not found")
pnpm_ver=$(pnpm --version 2>/dev/null || echo "not found")
python_ver=$(python3 --version 2>/dev/null || echo "not found")
brand_ok "convos-cli" "$convos_ver"
brand_ok "python" "$python_ver"
brand_ok "node" "$node_ver"
brand_ok "pnpm" "$pnpm_ver"

brand_done "Dependencies ready"
brand_flush
