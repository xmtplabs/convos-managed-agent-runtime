---
name: agentmail
description: |
  Email and calendar invites via AgentMail.
  USE WHEN: Sending emails, calendar invites (ICS), polling inbox.
  DON'T USE WHEN: User hasn't provided an email address. Task is just creating an ICS file without sending it (use fs tools).
  INPUTS: Recipient email, subject, content, optional ICS path. OUTPUTS: Sent confirmation.
  REQUIRES: AGENTMAIL_API_KEY, AGENTMAIL_INBOX_ID env vars (already configured in .env).
metadata: {"openclaw":{"requires":{"env":["AGENTMAIL_API_KEY","AGENTMAIL_INBOX_ID"]},"primaryEnv":"AGENTMAIL_API_KEY"}}
---

## Restrictions

You MUST only use the scripts listed below. You are FORBIDDEN from:

- Creating, deleting, or listing inboxes, pods, API keys, domains, or webhooks
- Calling the AgentMail API directly (via curl, fetch, or the SDK) outside of these scripts
- Reading, logging, printing, or exposing the AGENTMAIL_API_KEY value in any way
- Importing or instantiating AgentMailClient yourself — only the provided scripts may do so
- Using websocket or webhook features

Your access is limited to **sending and receiving email through your assigned inbox**.

## How to use

**Path rule:** Skills live under workspace. Use explicit path (OPENCLAW_STATE_DIR is set by the gateway):

`node $OPENCLAW_STATE_DIR/workspace/skills/agentmail/scripts/<script>.mjs ...`

# Setup

All scripts require `AGENTMAIL_API_KEY` and `AGENTMAIL_INBOX_ID` in the environment (already configured — do not modify).

### Send plain email

Use when the user wants to send an email (optionally with one attachment):

```bash
node $OPENCLAW_STATE_DIR/workspace/skills/agentmail/scripts/send-email.mjs \
  --to <recipient@email.com> \
  --subject "Subject line" \
  --text "Plain text body" \
  [--html "<p>HTML body</p>"] \
  [--attach /path/to/file]
```

### Send calendar invite (ICS by email)

Use when the user wants an ICS calendar invite sent by email:

```bash
node $OPENCLAW_STATE_DIR/workspace/skills/agentmail/scripts/send-calendar-email.mjs \
  --to <recipient@email.com> \
  --ics /path/to/file.ics \
  [--subject "Event name"]
```

### Poll / check inbox (new emails and replies)

Use to list **new/unread emails** and **threads that need a reply**. Output is JSON: `{ messages, threads }`. Prefer this script; do not use other check-inbox scripts from other skills.

- **New emails:** use `--labels unread`.
- **Replies to act on:** use `--threads` (unreplied threads per [AgentMail API](https://skills.sh/agentmail-to/agentmail-skills/agentmail)).

```bash
node $OPENCLAW_STATE_DIR/workspace/skills/agentmail/scripts/poll-inbox.mjs \
  [--limit 20] \
  [--labels unread] \
  [--threads]
```

Example: check new mail and unreplied threads in one run:

```bash
node $OPENCLAW_STATE_DIR/workspace/skills/agentmail/scripts/poll-inbox.mjs --limit 20 --labels unread --threads
```

Same via alias:

```bash
node $OPENCLAW_STATE_DIR/workspace/skills/agentmail/scripts/check-inbox.mjs --labels unread --threads
```
