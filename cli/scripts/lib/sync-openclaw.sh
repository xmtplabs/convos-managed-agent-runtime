#!/bin/sh
# Mirror openclaw/ subdirs into state dir. Skills are inside workspace.
# Source after init.sh (RUNTIME_DIR, STATE_DIR set).
set -e
for subdir in workspace extensions; do
  [ -d "$RUNTIME_DIR/$subdir" ] || continue
  mkdir -p "$STATE_DIR/$subdir"
  # Migration: remove obsolete convos dir (renamed to convos-sdk); prevents module resolution picking old node_modules
  if [ "$subdir" = "extensions" ] && [ -d "$STATE_DIR/extensions/convos" ]; then
    rm -rf "$STATE_DIR/extensions/convos"
  fi
  if command -v rsync >/dev/null 2>&1; then
    excl=""
    [ "$subdir" = "extensions" ] && excl="--exclude=node_modules"
    rsync -a --delete $excl "$RUNTIME_DIR/$subdir/" "$STATE_DIR/$subdir/"
  else
    rm -rf "${STATE_DIR:?}/$subdir"/*
    cp -r "$RUNTIME_DIR/$subdir/"* "$STATE_DIR/$subdir/" 2>/dev/null || true
  fi
  case "$subdir" in
    workspace)  emoji="📁" ;;
    extensions)  emoji="🔌" ;;
    *)           emoji="" ;;
  esac
  echo "  $emoji $subdir → $STATE_DIR/$subdir"
done
