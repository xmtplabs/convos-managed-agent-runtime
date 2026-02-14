#!/bin/sh
# Replace state extensions with repo extensions (no plugins.load.paths injection; single source).
# Source after init.sh (ROOT, EXTENSIONS_DIR set).
set -e
if [ -d "$ROOT/extensions" ]; then
  mkdir -p "$EXTENSIONS_DIR"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete --exclude=node_modules "$ROOT/extensions/" "$EXTENSIONS_DIR/"
  else
    rm -rf "${EXTENSIONS_DIR:?}"/*
    cp -r "$ROOT/extensions/"* "$EXTENSIONS_DIR/"
  fi
  list=""
  for d in "$EXTENSIONS_DIR"/*; do
    [ -d "$d" ] || continue
    name=$(basename "$d")
    list="${list:+$list, }$name"
  done
  echo "  🔌 extensions  → $EXTENSIONS_DIR${list:+ ($list)}"
fi
