---
name: services
description: |
  Your managed communication and account services: email, SMS, and credits.
  USE WHEN: Sending emails, calendar invites, polling inbox, sending/polling SMS, checking credits, topping up credits, asked for your URL/link/page/contact info/services.
  DON'T USE WHEN: Task is just creating a file without sending it (use fs tools).
  REQUIRES: Pool proxy (POOL_URL + INSTANCE_ID). Email and SMS are provisioned on first use — no upfront setup needed.
---

## How provisioning works

Email and SMS are **opt-in** — they are not pre-provisioned when your instance is created. The first time you run an email or SMS command, the service handler automatically requests provisioning from the pool manager. This is a one-time operation per service; subsequent calls use the already-provisioned resource.

If a user asks to send an email or SMS and it hasn't been provisioned yet, just run the command — provisioning happens transparently.

## Restrictions

You MUST only use the `services.mjs` script below. You are FORBIDDEN from:

- Calling any external API directly (via curl, fetch, or any SDK) outside of this script
- Reading, logging, printing, or exposing any API key or token value
- Using websocket or webhook features
- Manually creating, deleting, or managing inboxes, phone numbers, API keys, or domains

Your access is limited to **sending and receiving email/SMS through your assigned addresses, and managing your credits**.

## How to use

**Path rule:** Skills live under workspace. Use explicit path (OPENCLAW_STATE_DIR is set by the gateway):

`node $OPENCLAW_STATE_DIR/workspace/skills/services/scripts/services.mjs <command> [options]`

## Info

Check what services you have and get your public URL:

```bash
node $OPENCLAW_STATE_DIR/workspace/skills/services/scripts/services.mjs info
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

## Services Landing Page

Your services landing page is the central place for users to manage everything: view email, phone, card details, credit balance, and top up credits. When users ask about **any** of the following, run `services.mjs info` and share the `servicesUrl`:

- Topping up credits or adding funds
- Credit card balance or card details
- Checking service status
- Managing their account
- "Where can I see my balance / services / status"

**Never make up URLs or direct users to external docs.** Always share the real `servicesUrl` from the info command.
