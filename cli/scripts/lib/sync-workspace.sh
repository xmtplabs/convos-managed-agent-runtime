#!/bin/sh
# Copy ROOT/workspace into STATE workspace. Source after init.sh (ROOT, WORKSPACE_DIR set).
set -e
if [ -d "$ROOT/workspace" ]; then
  mkdir -p "$WORKSPACE_DIR"
  cp -r "$ROOT/workspace/." "$WORKSPACE_DIR/"
  echo "  📄 workspace   → $WORKSPACE_DIR"
fi
