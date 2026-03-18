#!/bin/sh
# Bootstrap hermes-agent (first run) and ensure all deps are installed.
set -e
. "$(dirname "$0")/lib/init.sh"

HERMES_TAG="v2026.3.17"

brand_section "Installing dependencies"

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
    uv venv "$VENV_DIR"
    brand_ok "venv" "created"
  else
    brand_ok "venv" "$VENV_DIR"
  fi
fi

# ── Hermes agent (local dev only — Docker pre-installs to /opt) ──────────
brand_subsection "hermes-agent"
if is_docker; then
  brand_ok "hermes-agent" "$HERMES_TAG (pre-installed)"
elif [ ! -d "$HERMES_AGENT_DIR/.git" ]; then
  brand_info "hermes-agent" "cloning $HERMES_TAG ..."
  mkdir -p "$(dirname "$HERMES_AGENT_DIR")"
  git clone --recurse-submodules --branch "$HERMES_TAG" --depth 1 \
    https://github.com/NousResearch/hermes-agent.git "$HERMES_AGENT_DIR"

  brand_info "hermes-agent" "installing Python deps ..."
  cd "$HERMES_AGENT_DIR"
  uv pip install $PIP_TARGET -e ".[all]"
  uv pip install $PIP_TARGET -e "./mini-swe-agent"
  cd "$ROOT"

  brand_ok "hermes-agent" "$HERMES_TAG (freshly installed)"
else
  brand_ok "hermes-agent" "$HERMES_TAG"
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
