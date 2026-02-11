#!/bin/sh
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLAW_DIR="$ROOT/../openclaw"
OPENCLAW_REPO="https://github.com/openclaw/openclaw.git"
OPENCLAW_BRANCH="main"

if [ ! -d "$CLAW_DIR" ]; then
  echo "[openclaw] Cloning $OPENCLAW_REPO (branch $OPENCLAW_BRANCH) into $CLAW_DIR"
  git clone --depth 1 --branch "$OPENCLAW_BRANCH" "$OPENCLAW_REPO" "$CLAW_DIR"
else
  echo "[openclaw] Pulling latest $OPENCLAW_BRANCH in $CLAW_DIR"
  git -C "$CLAW_DIR" fetch origin
  git -C "$CLAW_DIR" checkout "$OPENCLAW_BRANCH"
  git -C "$CLAW_DIR" pull --rebase
fi

echo "[openclaw] Building..."
cd "$CLAW_DIR"
pnpm install --no-frozen-lockfile
pnpm build
pnpm ui:install && pnpm ui:build
echo "[openclaw] Done. Run pnpm dev:local from convos-agent."
