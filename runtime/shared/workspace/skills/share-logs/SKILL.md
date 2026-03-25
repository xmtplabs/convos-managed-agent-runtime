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
node "$SKILLS_ROOT/services/scripts/services.mjs" info
```

This returns JSON with a `servicesUrl` field. Replace `/services` with `/trajectories` to get the logs URL.

Then create the flag file:

```bash
node -e "
var p = process.env.HERMES_HOME || process.env.OPENCLAW_STATE_DIR || '';
if (!p) p = require('fs').existsSync(require('path').join(process.env.HOME, '.hermes')) ? process.env.HOME + '/.hermes' : process.env.HOME + '/.openclaw';
require('fs').writeFileSync(require('path').join(p, '.share-trajectories'), '');
console.log('Sharing enabled at ' + p);
"
```

## Disable sharing

```bash
node -e "
var p = process.env.HERMES_HOME || process.env.OPENCLAW_STATE_DIR || '';
if (!p) p = require('fs').existsSync(require('path').join(process.env.HOME, '.hermes')) ? process.env.HOME + '/.hermes' : process.env.HOME + '/.openclaw';
try { require('fs').unlinkSync(require('path').join(p, '.share-trajectories')); } catch(e) {}
console.log('Sharing disabled');
"
```

## Response templates

**When enabling:**
> Your logs are now shared. Anyone with this link can view your conversation history:
>
> {servicesUrl with /services replaced by /trajectories}
>
> Say "stop sharing my logs" to disable access.

Never make up a URL. Always derive it from the `servicesUrl` returned by `services.mjs info`.

**When disabling:**
> Log sharing is off. The link no longer works.

## Important

- Always tell the user that the link is **public** — anyone with it can see full conversation logs including tool calls.
- If the user just asks about logs without clearly requesting sharing, explain what it does and ask if they want to proceed.
- The logs page shows the most recent conversations with full tool call details.
