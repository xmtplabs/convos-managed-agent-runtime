---
name: services
description: |
  Your managed communication and account services: email, SMS, and credits.
  USE WHEN: Sending emails, calendar invites, polling inbox, sending/polling SMS, checking credits, topping up credits, asked for your URL/link/page/contact info/services.
  DON'T USE WHEN: Task is just creating a file without sending it (use fs tools).
  REQUIRES: Pool proxy (POOL_URL + INSTANCE_ID). Email and SMS must be explicitly provisioned before use.
---

## How provisioning works

Email and SMS are **opt-in** — they are not pre-provisioned when your instance is created. You must explicitly provision each service before using it.

**Before sending any email or SMS, you MUST:**
1. Run `services.mjs info` to check if the service is already provisioned
2. If not provisioned, **ask the user** if they want to enable it (e.g. "I don't have email set up yet. Want me to provision an inbox?")
3. Only after the user confirms, run the provision command

```bash
# Provision email
node $OPENCLAW_STATE_DIR/workspace/skills/services/scripts/services.mjs email provision

# Provision SMS
node $OPENCLAW_STATE_DIR/workspace/skills/services/scripts/services.mjs sms provision
```

**Never provision without asking the user first.** If a user asks to send an email/SMS and the service isn't provisioned, ask them before enabling it.

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

Send an email (with optional attachments):

```bash
node $OPENCLAW_STATE_DIR/workspace/skills/services/scripts/services.mjs email send \
  --to <email> --subject "..." --text "..." \
  [--html "<p>...</p>"] [--attach /path/to/file]
```

Poll inbox:

```bash
node $OPENCLAW_STATE_DIR/workspace/skills/services/scripts/services.mjs email poll \
  [--limit 20] [--labels unread] [--threads] [--json]
```

Read a single email and download its attachments:

```bash
node $OPENCLAW_STATE_DIR/workspace/skills/services/scripts/services.mjs email read \
  --id "<id>"
```

- Use the `ID` shown in `poll` output — copy it exactly as displayed
- Attachments are saved to `$OPENCLAW_STATE_DIR/downloads/` automatically — do NOT use `--save-dir` or `~/Downloads`

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
