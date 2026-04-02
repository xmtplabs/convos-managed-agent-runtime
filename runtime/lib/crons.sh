#!/bin/sh
# Seed cron jobs. Called (sourced) from start.sh.
# Preserves agent-created jobs when jq is available.
# Caller must set CRON_DIR (e.g. $STATE_DIR/cron or $HERMES_HOME/cron).

_cron_dir="${CRON_DIR:?CRON_DIR must be set before sourcing crons.sh}"
_cron_store="$_cron_dir/jobs.json"
mkdir -p "$_cron_dir"

# Already seeded — nothing to do
if grep -q "seed-morning-checkin" "$_cron_store" 2>/dev/null; then
  brand_dim "cron" "morning check-in already seeded"
  unset _cron_dir _cron_store
  return 0 2>/dev/null || exit 0
fi

_now_ms=$(date +%s)000
_seed_job='{
  "id":"seed-morning-checkin","name":"Morning check-in","enabled":true,
  "createdAtMs":'"$_now_ms"',"updatedAtMs":'"$_now_ms"',
  "schedule":{"kind":"cron","expr":"0 8 * * *","tz":"America/New_York"},
  "sessionTarget":"main","wakeMode":"now",
  "payload":{"kind":"systemEvent","text":"Morning check-in: check for open threads, pending action items, or upcoming plans. If you find something concrete, send one sentence referencing it to the group. If there'\''s nothing real to reference, stay silent. Never send a message just to start a conversation, ask if anyone needs help, or say good morning without a reason."},
  "state":{}
}'

if command -v jq >/dev/null 2>&1 && [ -f "$_cron_store" ]; then
  jq --argjson job "$_seed_job" '.jobs += [$job]' "$_cron_store" > "$_cron_store.tmp" && mv "$_cron_store.tmp" "$_cron_store"
else
  printf '{"version":1,"jobs":[%s]}' "$_seed_job" > "$_cron_store"
fi

brand_ok "cron" "Seeded morning check-in"
unset _cron_dir _cron_store _now_ms _seed_job
