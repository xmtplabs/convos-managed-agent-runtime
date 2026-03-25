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

```bash
# Hermes sets HERMES_HOME, OpenClaw sets OPENCLAW_STATE_DIR — one will always be set.
# Fallback handles edge cases where neither is set.
_state="${HERMES_HOME:-${OPENCLAW_STATE_DIR:-}}"
[ -z "$_state" ] && { [ -d "$HOME/.hermes" ] && _state="$HOME/.hermes" || _state="$HOME/.openclaw"; }
touch "$_state/.share-trajectories"
```

After creating the file, give the user the link:

```
https://<PUBLIC_DOMAIN>/web-tools/trajectories
```

Build the URL by running this command and using its output:

```bash
if [ -n "$RAILWAY_PUBLIC_DOMAIN" ]; then
  echo "https://$RAILWAY_PUBLIC_DOMAIN/web-tools/trajectories"
elif [ -n "$NGROK_URL" ]; then
  echo "${NGROK_URL%/}/web-tools/trajectories"
else
  echo "http://localhost:${POOL_SERVER_PORT:-${PORT:-18789}}/web-tools/trajectories"
fi
```

## Disable sharing

```bash
_state="${HERMES_HOME:-${OPENCLAW_STATE_DIR:-}}"
[ -z "$_state" ] && { [ -d "$HOME/.hermes" ] && _state="$HOME/.hermes" || _state="$HOME/.openclaw"; }
rm -f "$_state/.share-trajectories"
```

## Response templates

**When enabling:**
> Your logs are now shared. Anyone with this link can view your conversation history:
>
> {url}
>
> Say "stop sharing my logs" to disable access.

**When disabling:**
> Log sharing is off. The link no longer works.

## Important

- Always tell the user that the link is **public** — anyone with it can see full conversation logs including tool calls.
- If the user just asks about logs without clearly requesting sharing, explain what it does and ask if they want to proceed.
- The logs page shows the most recent conversations with full tool call details.
