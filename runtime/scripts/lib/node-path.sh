#!/bin/sh
# Build NODE_PATH and PATH so Node resolves deps and CLIs from repo root.
# Source after init.sh.
# ROOT/node_modules: all deps (agentmail, @xmtp/convos-cli, openclaw, etc.)
# ROOT/node_modules/.bin: CLI tools (@telnyx/api-cli → telnyx, @bankr/cli → bankr)
_NP=""
[ -d "$STATE_DIR/node_modules" ] && _NP="$STATE_DIR/node_modules"
[ -d "$ROOT/node_modules" ] && _NP="${_NP:+$_NP:}$ROOT/node_modules"
[ -n "$_NP" ] && export NODE_PATH="$_NP${NODE_PATH:+:$NODE_PATH}"
unset _NP

_BIN="$ROOT/node_modules/.bin"
[ -d "$_BIN" ] && case ":$PATH:" in *":$_BIN:"*) ;; *) export PATH="$_BIN:$PATH" ;; esac
unset _BIN
