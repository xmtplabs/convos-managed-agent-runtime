#!/bin/sh
# Wipe convos identity keys, databases, and credentials so the next
# startup creates a fresh XMTP identity.
set -e
. "$(dirname "$0")/lib/init.sh"

CONVOS_HOME="${HOME}/.convos"

echo ""
echo "  Resetting Convos identity"
echo "  ═══════════════════════════"

# 1. CLI identity keys + databases
if [ -d "$CONVOS_HOME/identities" ]; then
  rm -rf "$CONVOS_HOME/identities"
  echo "  removed $CONVOS_HOME/identities"
fi
if [ -d "$CONVOS_HOME/db" ]; then
  rm -rf "$CONVOS_HOME/db"
  echo "  removed $CONVOS_HOME/db"
fi

# 2. Credentials file (identityId + ownerConversationId)
CRED_FILE="$STATE_DIR/credentials/convos-identity.json"
if [ -f "$CRED_FILE" ]; then
  rm -f "$CRED_FILE"
  echo "  removed $CRED_FILE"
fi

echo "  done — restart to create a new identity"
echo ""
