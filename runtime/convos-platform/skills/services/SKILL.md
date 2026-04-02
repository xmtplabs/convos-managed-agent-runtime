---
name: services
description: |
  Your managed communication and account services: email, SMS, and credits.
  USE WHEN: Sending emails, calendar invites, reading emails, sending SMS, checking credits, topping up credits.
  DON'T USE WHEN: Task is just creating a file without sending it (use fs tools).
  DON'T USE WHEN: User asks for their URL, link, page, or logs — use the convos-runtime skill instead.
  REQUIRES: Pool proxy (POOL_URL + INSTANCE_ID). Email and SMS must be explicitly provisioned before use.
---

## How provisioning works

Email and SMS are **opt-in** — they are not pre-provisioned when your instance is created. When you need a service that isn't provisioned yet, **provision it automatically** — do not ask the user for permission.

**Before sending any email or SMS, you MUST:**
1. Run `services.mjs info` to check if the service is already provisioned
2. If not provisioned, run the provision command immediately — no confirmation needed

```bash
# Provision email
node "$SKILLS_ROOT/services/scripts/services.mjs" email provision

# Provision SMS
node "$SKILLS_ROOT/services/scripts/services.mjs" sms provision
```

After auto-provisioning **SMS**, you MUST inform the user with this exact disclosure:

> By adding an assistant, you agree to receive SMS from your Convos AI assistant. Incoming SMS is reliable, but outbound SMS may not reach its destination. Full terms: https://learn.convos.org/sms

## How unprovisioning works

Users can remove their email or phone number at any time. When unprovisioned:
- **Email**: the inbox is permanently deleted (all messages are lost)
- **SMS**: the phone number is released back to the pool and may be reassigned to another instance

**Before unprovisioning, you MUST:**
1. Warn the user about what will happen (data loss for email, number loss for SMS)
2. Only after the user confirms, run the unprovision command

```bash
# Remove email
node "$SKILLS_ROOT/services/scripts/services.mjs" email unprovision

# Remove SMS
node "$SKILLS_ROOT/services/scripts/services.mjs" sms unprovision
```

**Never unprovision without explicit user confirmation.**

### SMS keyword handling

Inbound STOP, CANCEL, END, QUIT, UNSUBSCRIBE, START, YES, HELP, and INFO messages are handled automatically by the system. You will never see these in poll results. Do **not** attempt to respond to them yourself.

## How inbound messages arrive

Inbound emails and SMS are delivered automatically via webhooks — you do NOT need to poll for them. When a new email or text arrives, the system sends you a notification as a system message. Just respond to these notifications naturally.

- **Email notifications** look like: `[System: new email] From: ... | Subject: ... | ID: <MESSAGE_ID>` — announce the email to the group (who it's from, subject, and whether it has attachments). Do NOT auto-read or auto-open attachments — ask the user first. To read the full email when asked: `node "$SKILLS_ROOT/services/scripts/services.mjs" email read --id "<MESSAGE_ID>"` (copy the ID as-is, with angle brackets).
- **SMS notifications** look like: `You got a new text. "..." from +1...`

You can still use `email poll` or `sms poll` on demand if the user asks to check their inbox manually.

## Restrictions

You MUST only use the `services.mjs` script below. You are FORBIDDEN from:

- Calling any external API directly (via curl, fetch, or any SDK) outside of this script
- Reading, logging, printing, or exposing any API key or token value
- Manually creating, deleting, or managing inboxes, phone numbers, API keys, or domains

Your access is limited to **sending and receiving email/SMS through your assigned addresses, and managing your credits**.

## How to use

**Path rule:** Use the explicit path via SKILLS_ROOT:

`node "$SKILLS_ROOT/services/scripts/services.mjs" <command> [options]`

## Email

Send an email (with optional attachments):

```bash
node "$SKILLS_ROOT/services/scripts/services.mjs" email send \
  --to <email> --subject "..." --text "..." \
  [--html "<p>...</p>"] [--attach /path/to/file]
```

Send a calendar invite (ICS file):

```bash
node "$SKILLS_ROOT/services/scripts/services.mjs" email send-calendar \
  --to <email> --ics /path/to/file.ics [--subject "Event name"]
```

Poll inbox:

```bash
node "$SKILLS_ROOT/services/scripts/services.mjs" email poll \
  [--limit 20] [--labels unread] [--threads] [--json]
```

Read a single email and download its attachments:

```bash
node "$SKILLS_ROOT/services/scripts/services.mjs" email read \
  --id "<MESSAGE_ID>"
```

- `MESSAGE_ID` is the exact value from the `ID:` line in `poll` output or from the notification — copy it as-is, including angle brackets (e.g. `--id "<CAKj0nMf...>"`)
- Attachments are saved automatically — do NOT use `--save-dir` or `~/Downloads`

## SMS (US numbers only)

Send an SMS:

```bash
node "$SKILLS_ROOT/services/scripts/services.mjs" sms send \
  --to +15559876543 --text "Hello!"
```

Only US numbers (+1) are supported. Decline international SMS requests.

Poll received messages:

```bash
node "$SKILLS_ROOT/services/scripts/services.mjs" sms poll [--limit 10]
```

Check delivery status:

```bash
node "$SKILLS_ROOT/services/scripts/services.mjs" sms status <message-id>
```

## Credits

Check your current balance:

```bash
node "$SKILLS_ROOT/services/scripts/services.mjs" credits
```

Top up your credits:

```bash
node "$SKILLS_ROOT/services/scripts/services.mjs" credits topup
```
