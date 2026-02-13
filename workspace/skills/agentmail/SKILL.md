---
name: agentmail
description: |
  Email and calendar invites via AgentMail.
  USE WHEN: Sending emails, calendar invites (ICS), polling inbox.
  DON'T USE WHEN: User hasn't provided an email address. Task is just creating an ICS file without sending it (use fs tools).
  INPUTS: Recipient email, subject, content, optional ICS path. OUTPUTS: Sent confirmation.
  REQUIRES: AGENTMAIL_API_KEY, AGENTMAIL_INBOX_ID env vars (already configured in .env).
---

## How to use

IMPORTANT: Always use the pre-built scripts below. Do NOT import or use the agentmail SDK directly. Just run the scripts with `node`.

**Runtime:** `agentmail` is installed at app root (not in the workspace). Start the gateway via the project entrypoint (e.g. `pnpm dev` or `./scripts/entrypoint.sh`), or set `NODE_PATH` to the app's `node_modules`, so `node skills/agentmail/scripts/...` can resolve the package.

# Setup

All scripts require `AGENTMAIL_API_KEY` and `AGENTMAIL_INBOX_ID` in the environment (loaded from `.env`).

### Send plain email

Use when the user wants to send an email (optionally with one attachment):

```bash
node skills/agentmail/scripts/send-email.mjs \
  --to <recipient@email.com> \
  --subject "Subject line" \
  --text "Plain text body" \
  [--html "<p>HTML body</p>"] \
  [--attach /path/to/file]
```

### Send calendar invite (ICS by email)

Use when the user wants an ICS calendar invite sent by email:

```bash
node skills/agentmail/scripts/send-calendar-email.mjs \
  --to <recipient@email.com> \
  --ics /path/to/file.ics \
  [--subject "Event name"]
```

### Poll / check inbox (new emails and replies)

Use to list **new/unread emails** and **threads that need a reply**. Output is JSON: `{ messages, threads }`. Prefer this script; do not use other check-inbox scripts from other skills.

- **New emails:** use `--labels unread`.
- **Replies to act on:** use `--threads` (unreplied threads per [AgentMail API](https://skills.sh/agentmail-to/agentmail-skills/agentmail)).

```bash
node skills/agentmail/scripts/poll-inbox.mjs \
  [--limit 20] \
  [--labels unread] \
  [--threads]
```

Example: check new mail and unreplied threads in one run:

```bash
node skills/agentmail/scripts/poll-inbox.mjs --limit 20 --labels unread --threads
```

Same via alias:

```bash
node skills/agentmail/scripts/check-inbox.mjs --labels unread --threads
```
