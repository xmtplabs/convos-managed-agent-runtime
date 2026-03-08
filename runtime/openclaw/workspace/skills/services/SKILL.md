---
name: services
description: |
  Your managed communication and account services: email, SMS, credits, and spending card.
  USE WHEN: Sending emails, calendar invites, polling inbox, sending/polling SMS, checking credits, topping up credits, checking spending card info/details, making purchases with your card, asked for your URL/link/page/contact info/services.
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

## Credits (your power)

Credits are **prepaid**. They do NOT reset monthly or on any schedule. The user buys a credit pack, your limit goes up, and usage accumulates against it. When credits run out, the user buys more.

- `type: "prepaid"` — no automatic resets, no monthly cycle
- `limit` — total credits ever granted (grows when user tops up)
- `usage` — total credits ever spent (only goes up)
- `remaining` — how much you have left (`limit - usage`)

Check your current balance:

```bash
node $OPENCLAW_STATE_DIR/workspace/skills/services/scripts/services.mjs credits
```

Top up your credits:

```bash
node $OPENCLAW_STATE_DIR/workspace/skills/services/scripts/services.mjs credits topup
```

## Spending Card (for purchases)

A **prepaid virtual Visa** with a one-time spending cap funded by the user. The limit does NOT reset — it's an all-time cap. If the user adds more funds, the cap increases.

Check if you have a spending card:

```bash
node $OPENCLAW_STATE_DIR/workspace/skills/services/scripts/services.mjs card
```

Get full card details (number, CVC, expiry, billing address) for making purchases:

```bash
node $OPENCLAW_STATE_DIR/workspace/skills/services/scripts/services.mjs card details
```

Use the card details when you need to make online purchases (fill forms, call APIs that need payment). If there is no card, direct the user to the services page to get one.

**Never share full card details in chat messages.** Only use them silently when filling payment forms or making API calls. If the user asks about the card, share only the last 4 digits and remaining balance.

## Services Landing Page

Your services landing page is the central place for users to manage everything: view email, phone, card details, credit balance, and top up credits. When users ask about **any** of the following, run `services.mjs info` and share the `servicesUrl`:

- Topping up credits or adding funds
- Credit card balance or card details
- Checking service status
- Managing their account
- "Where can I see my balance / services / status"

**Never make up URLs or direct users to external docs.** Always share the real `servicesUrl` from the info command.
