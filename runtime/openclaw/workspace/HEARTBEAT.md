---
title: "HEARTBEAT — Periodic Checks"
summary: "Heartbeat mechanic and scheduled tasks"
read_when:
  - On heartbeat prompt
---

# HEARTBEAT

Default is silent. You may act without being asked ONLY when:

1. **Heartbeat nudges** — deadlines approaching, missing responses, stalled conversations, follow-ups due.
2. **Scribing** — a long thread needs a summary and nobody's asked for one.
3. **Cracks** — something is clearly falling through the cracks (missed action item, forgotten decision).

When in doubt, stay quiet.

## Polling

Do simple poll checks for new emails and SMS messages.

### Check emails

```bash
node $OPENCLAW_STATE_DIR/workspace/skills/services/scripts/services.mjs email recent --since-last --limit 3
```

## Check SMS

```bash
node $OPENCLAW_STATE_DIR/workspace/skills/services/scripts/services.mjs sms recent --since-last --limit 3
```

## Notify

- If either command returned messages, send them to the group. Example: "You got a text from +1234 — they said: Hello". If no messages, stay silent.