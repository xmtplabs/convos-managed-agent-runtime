---
name: telnyx-cli
description: |
  SMS messaging via Telnyx using your assigned phone number.
  USE WHEN: Sending or receiving SMS messages, checking message status.
  DON'T USE WHEN: User hasn't provided a recipient phone number.
  INPUTS: Recipient phone number, message text. OUTPUTS: Sent confirmation, message status.
  REQUIRES: TELNYX_API_KEY, TELNYX_PHONE_NUMBER env vars (already configured in .env).
metadata: {"openclaw":{"emoji":"📱","requires":{"bins":["telnyx"],"env":["TELNYX_API_KEY","TELNYX_PHONE_NUMBER"]},"primaryEnv":"TELNYX_API_KEY"}}
---

## Your Phone Number

You have one assigned phone number: `$TELNYX_PHONE_NUMBER`. Always use this as the `--from` number when sending messages. Do NOT purchase, release, or manage phone numbers.

## Restrictions

You MUST only use the commands listed below. You are FORBIDDEN from:

- Purchasing, releasing, searching, or managing phone numbers (`number buy`, `number release`, `number search`)
- Creating or modifying messaging profiles, webhooks, or account settings
- Reading, logging, printing, or exposing the TELNYX_API_KEY value in any way
- Calling the Telnyx API directly (via curl, fetch, or SDK) outside of the CLI commands below
- Sending messages from any number other than `$TELNYX_PHONE_NUMBER`

Your access is limited to **sending and receiving SMS through your assigned phone number**.

## Commands

### Send SMS

```bash
telnyx message send --from $TELNYX_PHONE_NUMBER --to +15559876543 --text "Hello!"
```

### List messages

```bash
telnyx message list
```

### Get message status

```bash
telnyx message get MESSAGE_ID
```

## Output Formats

```bash
# Table (default)
telnyx message list

# JSON
telnyx message list --output json

# CSV
telnyx message list --output csv
```

## Tips

- Rate limit: 100 req/s — add `sleep 1` for bulk operations
- SMS works for international numbers — include the full country code (e.g. +44, +52, +55)
- Use `--output json` for structured data
- Get help: `telnyx message --help`
