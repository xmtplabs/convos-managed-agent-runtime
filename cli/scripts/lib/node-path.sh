#!/bin/sh
# Build NODE_PATH so Node resolves deps from state dir and repo root. Source after init.sh.
# STATE_DIR/node_modules: skill deps (e.g. agentmail)
# ROOT/node_modules: repo-level deps (e.g. @xmtp/convos-cli, openclaw)
_PATH=""
[ -d "$STATE_DIR/node_modules" ] && _PATH="$STATE_DIR/node_modules"
[ -d "$ROOT/node_modules" ] && _PATH="${_PATH:+$_PATH:}$ROOT/node_modules"
[ -n "$_PATH" ] && export NODE_PATH="$_PATH${NODE_PATH:+:$NODE_PATH}"
unset _PATH
