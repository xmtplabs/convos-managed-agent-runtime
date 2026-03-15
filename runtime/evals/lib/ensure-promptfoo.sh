#!/bin/sh
# Ensure promptfoo is installed and on PATH.
#
# @inquirer/* 5.1.1 / 6.0.9 / 11.1.6 were published without dist/ files,
# breaking ESM resolution. npm overrides pin known-good versions.
# Once upstream publishes a fix, the overrides can be removed.

PROMPTFOO_VERSION="0.121.2"
_PF_DIR="${PROMPTFOO_DIR:-/tmp/promptfoo-runner}"

if [ -x "$_PF_DIR/node_modules/.bin/promptfoo" ]; then
  export PATH="$_PF_DIR/node_modules/.bin:$PATH"
  return 0 2>/dev/null || exit 0
fi

echo "  Installing promptfoo@$PROMPTFOO_VERSION ..."

mkdir -p "$_PF_DIR"
cat > "$_PF_DIR/package.json" <<PKGJSON
{
  "private": true,
  "overrides": {
    "@inquirer/checkbox": "5.1.0",
    "@inquirer/confirm": "6.0.8",
    "@inquirer/core": "11.1.5",
    "@inquirer/editor": "5.0.8",
    "@inquirer/input": "5.0.8",
    "@inquirer/select": "5.1.0"
  }
}
PKGJSON

(cd "$_PF_DIR" && npm install "promptfoo@$PROMPTFOO_VERSION" --no-audit --no-fund 2>&1 | tail -1)

export PATH="$_PF_DIR/node_modules/.bin:$PATH"
