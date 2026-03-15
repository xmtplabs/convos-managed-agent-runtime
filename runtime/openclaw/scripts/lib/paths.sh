#!/bin/sh
# Derive state paths from OPENCLAW_STATE_DIR (or $HOME/.openclaw). Source after ROOT set; load .env before this so OPENCLAW_STATE_DIR is set.
# Sets: RUNTIME_DIR, STATE_DIR, WORKSPACE_DIR, SKILLS_DIR, EXTENSIONS_DIR, CONFIG
# Docker copies files to $ROOT/openclaw/; locally ROOT is already the openclaw dir.
if [ -f "$ROOT/openclaw.json" ]; then
  RUNTIME_DIR="$ROOT"
else
  RUNTIME_DIR="$ROOT/openclaw"
fi
STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
WORKSPACE_DIR="$STATE_DIR/workspace"
SKILLS_DIR="$WORKSPACE_DIR/skills"
EXTENSIONS_DIR="$STATE_DIR/extensions"
CONFIG="$STATE_DIR/openclaw.json"
