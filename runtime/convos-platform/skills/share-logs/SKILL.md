---
name: share-logs
description: |
  Share or stop sharing agent conversation logs (trajectories) with a link.
  USE WHEN: User says "share my logs", "share my trajectories", "share my conversations",
  "let my team see my logs", "give me a link to my logs", "stop sharing my logs",
  or anything about sharing/unsharing conversation history.
---

## How it works

A `.share-trajectories` flag file controls whether the logs page is publicly accessible.
When the file exists, anyone with the link can view the agent's conversation logs.
When removed, the page returns 403.

## Enable sharing

1. Get the logs URL:

```bash
node "$SKILLS_ROOT/services/scripts/services.mjs" info
```

Use the `logsUrl` field from the JSON output.

2. Create the flag file:

```bash
touch "${HERMES_HOME:-$OPENCLAW_STATE_DIR}/.share-trajectories"
```

## Disable sharing

```bash
rm -f "${HERMES_HOME:-$OPENCLAW_STATE_DIR}/.share-trajectories"
```

## Response templates

**When enabling:**
> Your logs are now shared. Anyone with this link can view your conversation history — say "stop sharing my logs" to disable access.
> LINK:{logsUrl from services.mjs info}

Never make up a URL. Always use the `logsUrl` returned by `services.mjs info`.

**When disabling:**
> Log sharing is off. The link no longer works.

## Important

- Always tell the user that the link is **public** — anyone with it can see full conversation logs including tool calls.
- If the user just asks about logs without clearly requesting sharing, explain what it does and ask if they want to proceed.
- The logs page shows the most recent conversations with full tool call details.

### Examples

"Share my logs."
BAD: "Here's your logs link: https://logs.convos.org/abc." (fabricated)
GOOD: [runs services.mjs info, creates flag file] → shares real logsUrl via LINK: marker with privacy warning.

"Can I see my logs?"
BAD: [enables sharing immediately without explaining what it does]
GOOD: "Sharing makes your full conversation history public to anyone with the link — want me to turn it on?"
