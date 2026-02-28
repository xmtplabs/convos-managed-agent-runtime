---
name: telnyx-cli
description: |
  SMS messaging via Telnyx using your assigned phone number.
  USE WHEN: Sending SMS messages, checking message delivery status.
  DON'T USE WHEN: User hasn't provided a recipient phone number.
  INPUTS: Recipient phone number, message text. OUTPUTS: Sent confirmation, message status.
  REQUIRES: TELNYX_API_KEY, TELNYX_PHONE_NUMBER env vars (already configured in .env).
metadata: {"openclaw":{"emoji":"📱","requires":{"env":["TELNYX_API_KEY","TELNYX_PHONE_NUMBER"]},"primaryEnv":"TELNYX_API_KEY"}}
---

## Your Phone Number

You have one assigned phone number: `$TELNYX_PHONE_NUMBER`. It is used automatically as the sender for all outgoing SMS. Do NOT purchase, release, or manage phone numbers.

## Restrictions

You MUST only use the scripts listed below. You are FORBIDDEN from:

- Purchasing, releasing, searching, or managing phone numbers
- Creating or modifying messaging profiles, webhooks, or account settings
- Reading, logging, printing, or exposing the TELNYX_API_KEY value in any way
- Calling the Telnyx API directly (via curl, fetch, or SDK) outside of the scripts below
- Sending messages from any number other than `$TELNYX_PHONE_NUMBER`

Your access is limited to **sending SMS and checking delivery status through your assigned phone number**.

## How to use

**Path rule:** Skills live under workspace. Use explicit path (OPENCLAW_STATE_DIR is set by the gateway):

`node $OPENCLAW_STATE_DIR/workspace/skills/telnyx-cli/scripts/<script>.mjs ...`

## Commands

### Send SMS

```bash
node $OPENCLAW_STATE_DIR/workspace/skills/telnyx-cli/scripts/send-sms.mjs \
  --to +15559876543 \
  --text "Hello!"
```

International numbers are supported — include the full country code (e.g. +1, +44, +52, +55).

### Check message status

```bash
node $OPENCLAW_STATE_DIR/workspace/skills/telnyx-cli/scripts/get-message.mjs MESSAGE_ID
```

## Tips

- Rate limit: 100 req/s — add `sleep 1` for bulk operations
- The `--to` number must be in E.164 format (e.g. `+13125551234`)
- The send script outputs a Message ID you can use with get-message to check delivery
- SMS supports all country codes — never decline international SMS requests
