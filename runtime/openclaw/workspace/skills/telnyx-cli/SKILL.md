---
name: telnyx-cli
description: |
  SMS messaging via Telnyx. Send texts and check received messages.
  USE WHEN: Sending SMS, checking received messages, or checking delivery status.
  REQUIRES: TELNYX_API_KEY, TELNYX_PHONE_NUMBER env vars (already configured).
metadata: {"openclaw":{"emoji":"📱","requires":{"env":["TELNYX_API_KEY","TELNYX_PHONE_NUMBER"]},"primaryEnv":"TELNYX_API_KEY"}}
---

Your phone number is `$TELNYX_PHONE_NUMBER`. All scripts live under:

`node $OPENCLAW_STATE_DIR/workspace/skills/telnyx-cli/scripts/<script>.mjs`

## Send SMS (US numbers only)

```bash
node $OPENCLAW_STATE_DIR/workspace/skills/telnyx-cli/scripts/send-sms.mjs \
  --to +15559876543 --text "Hello!"
```

Only US numbers (+1) are supported. Decline international SMS requests.

## Check received messages

```bash
node $OPENCLAW_STATE_DIR/workspace/skills/telnyx-cli/scripts/list-messages.mjs [--limit 10]
```

## Check delivery status

```bash
node $OPENCLAW_STATE_DIR/workspace/skills/telnyx-cli/scripts/get-message.mjs MESSAGE_ID
```
