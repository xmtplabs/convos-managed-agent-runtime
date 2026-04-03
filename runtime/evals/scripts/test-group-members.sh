#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# test-group-members.sh
#
# Validates that the Hermes agent can see group member names in context,
# including after profile name changes and member removal.
#
# Prerequisites:
#   - convos-cli installed (npx @xmtp/convos-cli or global)
#   - A Hermes agent running via `pnpm start:hermes` in another terminal,
#     already serving in a conversation
#   - The invite link for that conversation
#
# Usage:
#   ./scripts/test-group-members.sh <invite-link-or-slug>
#
# Each simulated member gets its own --home directory so the CLI doesn't
# conflict on "already joined" checks. Directories are cleaned up on exit.
# ---------------------------------------------------------------------------

INVITE="${1:?Usage: $0 <invite-link-or-slug>}"
CONVOS="${CONVOS_CLI:-npx @xmtp/convos-cli}"

ENV_ARGS=()
if [[ -n "${CONVOS_ENV:-}" ]]; then
  ENV_ARGS=(--env "$CONVOS_ENV")
fi

JOIN_TIMEOUT=60
TMPDIR_BASE=$(mktemp -d "${TMPDIR:-/tmp}/convos-test-XXXXXX")

log()  { echo -e "\n\033[1;36m>>> $*\033[0m"; }
warn() { echo -e "\033[1;33m    $*\033[0m"; }
ok()   { echo -e "\033[1;32m    $*\033[0m"; }
fail() { echo -e "\033[1;31mERROR: $*\033[0m" >&2; exit 1; }

# Track member home dirs for cleanup
MEMBER_HOMES=()
cleanup() {
  log "Cleaning up..."
  for home in "${MEMBER_HOMES[@]}"; do
    rm -rf "$home" 2>/dev/null || true
  done
  rmdir "$TMPDIR_BASE" 2>/dev/null || true
}
trap cleanup EXIT

# --- Create an isolated home dir for a member -----------------------------
make_member_home() {
  local name="$1"
  local home="$TMPDIR_BASE/$name"
  mkdir -p "$home"
  # Copy .env so the member picks up env/gateway config
  # --home replaces ~/.convos entirely, so .env goes at the root
  if [[ -f "$HOME/.convos/.env" ]]; then
    cp "$HOME/.convos/.env" "$home/.env"
  fi
  MEMBER_HOMES+=("$home")
  echo "$home"
}

# --- Join a member --------------------------------------------------------
# Returns "home_dir:conversation_id"
join_member() {
  local name="$1"
  local home
  home=$(make_member_home "$name")

  log "Joining as $name..." >&2
  local raw_output
  raw_output=$($CONVOS conversations join "$INVITE" \
    --profile-name "$name" \
    --timeout "$JOIN_TIMEOUT" \
    --home "$home" \
    --json "${ENV_ARGS[@]}" 2>&1) || {
    echo "    join output: $raw_output" >&2
    fail "Failed to join as $name"
  }

  # CLI mixes progress text with JSON on stdout — extract the JSON object
  local json_output conv_id
  json_output=$(echo "$raw_output" | sed -n '/^{/,/^}/p')
  conv_id=$(echo "$json_output" | jq -r '.conversationId // empty')

  [[ -n "$conv_id" ]] || fail "No conversationId for $name. Output: $raw_output"

  ok "$name joined (conv=$conv_id)" >&2
  echo "$home:$conv_id"
}

# --- Send a message from a member ----------------------------------------
send() {
  local home="$1" conv_id="$2" text="$3"
  warn "[$4] $text"
  $CONVOS conversation send-text "$conv_id" "$text" \
    --home "$home" "${ENV_ARGS[@]}" 2>/dev/null \
    || warn "send-text failed (may be ok if member was removed)"
}

# --- Update a member's profile name ---------------------------------------
update_profile() {
  local home="$1" conv_id="$2" new_name="$3"
  $CONVOS conversation update-profile "$conv_id" --name "$new_name" \
    --home "$home" "${ENV_ARGS[@]}" 2>/dev/null \
    || warn "update-profile failed for $new_name"
}

# --- Get inbox ID for a member --------------------------------------------
get_inbox_id() {
  local home="$1"
  local raw
  raw=$($CONVOS identity list --home "$home" --json "${ENV_ARGS[@]}" 2>/dev/null) || true
  # identity list may return an array or an object with .identities
  echo "$raw" | jq -r '
    if type == "array" then .[0].inboxId // empty
    elif .identities then .identities[0].inboxId // empty
    else empty end
  ' 2>/dev/null || true
}

# --- Read recent messages -------------------------------------------------
read_messages() {
  local home="$1" conv_id="$2" limit="${3:-20}"
  local raw
  raw=$($CONVOS conversation messages "$conv_id" --sync --limit "$limit" \
    --home "$home" --json "${ENV_ARGS[@]}" 2>/dev/null) || true

  if [[ -z "$raw" ]]; then
    warn "Could not read messages"
    return 1
  fi

  # Messages may be in .messages array or top-level array
  echo "$raw" | jq -r '
    (if type == "array" then . elif .messages then .messages else [] end)
    | .[]
    | (.senderProfile.name // (.senderInboxId // "unknown")[0:12]) + " : " + (.content // "(no content)")
  ' 2>/dev/null || echo "$raw"
}

# ---------------------------------------------------------------------------
# Main flow
# ---------------------------------------------------------------------------

log "Starting group member test"
echo "    Invite: $INVITE"
echo "    Temp dir: $TMPDIR_BASE"

# ── Phase 1: Join members ─────────────────────────────────────────────────

ALICE_REF=$(join_member "Alice")
ALICE_HOME="${ALICE_REF%%:*}"
ALICE_CONV="${ALICE_REF##*:}"
sleep 2

BOB_REF=$(join_member "Bob")
BOB_HOME="${BOB_REF%%:*}"
BOB_CONV="${BOB_REF##*:}"
sleep 2

CHARLIE_REF=$(join_member "Charlie")
CHARLIE_HOME="${CHARLIE_REF%%:*}"
CHARLIE_CONV="${CHARLIE_REF##*:}"
sleep 2

# ── Phase 2: Chat back and forth ──────────────────────────────────────────

log "Phase 2: Members chatting..."

send "$ALICE_HOME" "$ALICE_CONV" "hey everyone! Alice here" "Alice"
sleep 3
send "$BOB_HOME" "$BOB_CONV" "hey Alice! Bob checking in" "Bob"
sleep 3
send "$CHARLIE_HOME" "$CHARLIE_CONV" "Charlie here too, what's up?" "Charlie"
sleep 3
send "$ALICE_HOME" "$ALICE_CONV" "just testing out the group, glad we're all here" "Alice"
sleep 5

# ── Phase 3: Bob renames himself ──────────────────────────────────────────
# Tests that the agent picks up profile name changes via group_updated events

log "Phase 3: Bob renames himself to Roberto..."
update_profile "$BOB_HOME" "$BOB_CONV" "Roberto"
sleep 5

send "$BOB_HOME" "$BOB_CONV" "hey it's me, I go by Roberto now" "Roberto"
sleep 5

# ── Phase 4: Charlie leaves ───────────────────────────────────────────────

log "Phase 4: Charlie leaves the group..."
CHARLIE_INBOX=$(get_inbox_id "$CHARLIE_HOME")
if [[ -n "$CHARLIE_INBOX" ]]; then
  $CONVOS conversation remove-members "$ALICE_CONV" "$CHARLIE_INBOX" \
    --home "$ALICE_HOME" "${ENV_ARGS[@]}" 2>&1 \
    || warn "remove-members failed — Charlie may need to be removed manually"
  ok "Charlie removed ($CHARLIE_INBOX)"
else
  warn "Could not get Charlie's inbox ID — skipping removal"
fi
sleep 5

# ── Phase 5: Dana joins ──────────────────────────────────────────────────

log "Phase 5: Dana joins the group..."
DANA_REF=$(join_member "Dana")
DANA_HOME="${DANA_REF%%:*}"
DANA_CONV="${DANA_REF##*:}"
sleep 3

send "$DANA_HOME" "$DANA_CONV" "hi! Dana just joined, nice to meet everyone" "Dana"
sleep 5

# ── Phase 6: Ask the agent who's in the group ─────────────────────────────

log "Phase 6: Asking the agent who's in the group..."
send "$BOB_HOME" "$BOB_CONV" "hey, can you tell me who's currently in this group? please list everyone by name" "Roberto"

log "Waiting for agent response (30s)..."
sleep 30

# ── Phase 7: Read recent messages and check results ───────────────────────

log "Phase 7: Reading recent messages..."
echo ""
read_messages "$ALICE_HOME" "$ALICE_CONV" 25

echo ""
echo "─────────────────────────────────────────────────────"
log "Expected results:"
echo "    Members: Alice, Roberto (was Bob), Dana + the agent"
echo "    Charlie should NOT be listed (was removed)"
echo "    Bob should appear as 'Roberto' (renamed mid-conversation)"
echo "    Agent should identify itself — look for '(you)' in logs"
echo "─────────────────────────────────────────────────────"
