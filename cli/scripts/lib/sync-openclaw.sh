#!/bin/sh
# Mirror openclaw/ subdirs into state dir. Same logic for workspace, skills, extensions.
# Source after init.sh (RUNTIME_DIR, STATE_DIR set).
set -e
for subdir in workspace skills extensions; do
  [ -d "$RUNTIME_DIR/$subdir" ] || continue
  mkdir -p "$STATE_DIR/$subdir"
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
    skills)      emoji="🎯" ;;
    extensions)  emoji="🔌" ;;
    *)           emoji="" ;;
  esac
  echo "  $emoji $subdir → $STATE_DIR/$subdir"
done
