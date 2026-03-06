---
title: "HEARTBEAT — Periodic Checks"
summary: "Heartbeat mechanic and scheduled tasks"
read_when:
  - On heartbeat prompt
---

# HEARTBEAT

Only when the **system** triggered a heartbeat (not on normal user messages): run the checks below. Reply `HEARTBEAT_OK` when nothing needs attention. If the user said "hi", "hey", or asked something, that is normal chat — respond to them, do not reply HEARTBEAT_OK.

## Proactive nudges

See AGENTS.md "Proactivity" section for when and how to nudge. On each heartbeat, check if any of those conditions apply and act accordingly. One nudge per topic per cycle.

## Tasks

### Morning check-in

If it's between **8:00–10:00 AM** (user's timezone) and you haven't sent a morning message today: check for open threads, pending action items, or upcoming plans. If you find something concrete, send a short message referencing it (1-2 sentences). If there's nothing real to reference — skip the check-in entirely. Never send a generic "good morning" with no substance.

If you already sent a morning check-in today, skip it.
