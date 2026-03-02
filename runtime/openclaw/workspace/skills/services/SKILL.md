---
name: services
description: |
  Your managed communication and account services: email, SMS, and credits.
  USE WHEN: Sending emails, calendar invites, polling inbox, sending/polling SMS, checking credits, topping up credits, asked for your URL/link/page/contact info/services.
  DON'T USE WHEN: Task is just creating a file without sending it (use fs tools).
  REQUIRES: Environment is already configured — do not modify env vars.
---

## Restrictions

You MUST only use the `services.mjs` script below. You are FORBIDDEN from:

- Calling any external API directly (via curl, fetch, or any SDK) outside of this script
- Reading, logging, printing, or exposing any API key or token value
- Using websocket or webhook features
- Creating, deleting, or managing inboxes, phone numbers, API keys, or domains

Your access is limited to **sending and receiving email/SMS through your assigned addresses, and managing your credits**.

## How to use

**Path rule:** Skills live under workspace. Use explicit path (OPENCLAW_STATE_DIR is set by the gateway):

`node $OPENCLAW_STATE_DIR/workspace/skills/services/scripts/services.mjs <command> [options]`

## Identity

Check what services you have and get your public URL:

```bash
node $OPENCLAW_STATE_DIR/workspace/skills/services/scripts/services.mjs identity
```

Returns JSON: `{ email, phone, servicesUrl }`

**You MUST run this command when someone asks:**
- "what's your URL / link / page"
- "share your services / contact info"
- "can I see your services"
- anything about your public-facing address or dashboard

The `servicesUrl` is your public services page. Always share it as-is — never make up a URL.

## Email

Send a plain email:

```bash
node $OPENCLAW_STATE_DIR/workspace/skills/services/scripts/services.mjs email send \
  --to <email> --subject "..." --text "..." \
  [--html "<p>...</p>"] [--attach /path/to/file]
```

Send a calendar invite (ICS file):

```bash
node $OPENCLAW_STATE_DIR/workspace/skills/services/scripts/services.mjs email send-calendar \
  --to <email> --ics /path/to/file.ics [--subject "Event name"]
```

Poll inbox for new emails and threads:

```bash
node $OPENCLAW_STATE_DIR/workspace/skills/services/scripts/services.mjs email poll \
  [--limit 20] [--labels unread] [--threads]
```

Example — check new mail and unreplied threads in one run:

```bash
node $OPENCLAW_STATE_DIR/workspace/skills/services/scripts/services.mjs email poll --limit 20 --labels unread --threads
```

## SMS (US numbers only)

Send an SMS:

```bash
node $OPENCLAW_STATE_DIR/workspace/skills/services/scripts/services.mjs sms send \
  --to +15559876543 --text "Hello!"
```

Only US numbers (+1) are supported. Decline international SMS requests.

Poll received messages:

```bash
node $OPENCLAW_STATE_DIR/workspace/skills/services/scripts/services.mjs sms poll [--limit 10]
```

Check delivery status:

```bash
node $OPENCLAW_STATE_DIR/workspace/skills/services/scripts/services.mjs sms status <message-id>
```

## Credits

Check your current balance:

```bash
node $OPENCLAW_STATE_DIR/workspace/skills/services/scripts/services.mjs credits
```

Top up your credits:

```bash
node $OPENCLAW_STATE_DIR/workspace/skills/services/scripts/services.mjs credits topup
```
