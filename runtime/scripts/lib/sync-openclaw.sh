#!/bin/sh
# Mirror openclaw/ subdirs into state dir. Skills are inside workspace.
# Source after init.sh (RUNTIME_DIR, STATE_DIR set).
set -e

copy_tree_snapshot() {
  src_dir="$1"
  dst_dir="$2"

  if command -v rsync >/dev/null 2>&1; then
    rsync -a --checksum --delete "$src_dir/" "$dst_dir/"
    return
  fi

  rm -rf "$dst_dir"
  mkdir -p "$dst_dir"
  cp -R "$src_dir/." "$dst_dir/"
}

sync_workspace_dir() {
  src_dir="$RUNTIME_DIR/workspace"
  dst_dir="$STATE_DIR/workspace"
  base_dir="$STATE_DIR/.workspace-base"

  mkdir -p "$dst_dir" "$base_dir"

  bootstrap_sync=0
  if [ -z "$(find "$base_dir" -mindepth 1 -print -quit 2>/dev/null)" ]; then
    bootstrap_sync=1
  fi

  find "$src_dir" -type d | while IFS= read -r src_path; do
    [ "$src_path" = "$src_dir" ] && continue
    rel_path=${src_path#"$src_dir"/}
    mkdir -p "$dst_dir/$rel_path"
  done

  find "$src_dir" -type f | while IFS= read -r src_path; do
    rel_path=${src_path#"$src_dir"/}
    dst_path="$dst_dir/$rel_path"
    base_path="$base_dir/$rel_path"

    if [ ! -e "$dst_path" ]; then
      mkdir -p "$(dirname "$dst_path")"
      cp -p "$src_path" "$dst_path"
      continue
    fi

    if [ ! -e "$base_path" ]; then
      [ "$bootstrap_sync" = "1" ] && continue
      continue
    fi

    if cmp -s "$dst_path" "$base_path"; then
      mkdir -p "$(dirname "$dst_path")"
      cp -p "$src_path" "$dst_path"
    fi
  done

  copy_tree_snapshot "$src_dir" "$base_dir"
}

for subdir in workspace extensions; do
  [ -d "$RUNTIME_DIR/$subdir" ] || continue
  mkdir -p "$STATE_DIR/$subdir"

  if [ "$subdir" = "workspace" ]; then
    sync_workspace_dir
  elif command -v rsync >/dev/null 2>&1; then
    rsync -a --delete --exclude=node_modules "$RUNTIME_DIR/$subdir/" "$STATE_DIR/$subdir/"
  else
    rm -rf "${STATE_DIR:?}/$subdir"/*
    cp -r "$RUNTIME_DIR/$subdir/"* "$STATE_DIR/$subdir/" 2>/dev/null || true
  fi

  case "$subdir" in
    workspace)  emoji="📁" ;;
    extensions) emoji="🔌" ;;
    *)          emoji="" ;;
  esac
  echo "  $emoji $subdir → $STATE_DIR/$subdir"
done
