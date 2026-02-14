#!/bin/sh
# Copy upgrade .md files and memory/.gitkeep from ROOT/workspace to WORKSPACE_DIR. Source after init.sh.
set -e
if [ -d "$ROOT/workspace" ]; then
  for f in SOUL.md AGENTS.md IDENTITY.md TOOLS.md; do
    [ -f "$ROOT/workspace/$f" ] && cp "$ROOT/workspace/$f" "$WORKSPACE_DIR/$f"
  done
  [ -d "$ROOT/workspace/memory" ] && mkdir -p "$WORKSPACE_DIR/memory" && [ -f "$ROOT/workspace/memory/.gitkeep" ] && cp "$ROOT/workspace/memory/.gitkeep" "$WORKSPACE_DIR/memory/"
fi
