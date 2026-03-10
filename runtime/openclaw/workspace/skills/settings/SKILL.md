---
name: settings
description: |
  Self-management commands: upgrade runtime, reset instance, clear memory.
  USE WHEN: User sends /upgrade, /reset, /clear-memory, or asks to update/restart/wipe sessions.
  REQUIRES: Pool proxy (POOL_URL + INSTANCE_ID + OPENCLAW_GATEWAY_TOKEN).
---

## Commands

### Upgrade (`/upgrade`)

Pull the latest runtime image and redeploy. You will go offline briefly while Railway deploys the new image.

```bash
node $OPENCLAW_STATE_DIR/workspace/skills/settings/scripts/settings.mjs upgrade
```

**Always confirm with the user before running this.** Tell them you'll be offline for ~30-60 seconds during the upgrade.

### Reset (`/reset`)

Redeploy the current image (same version, fresh container). Useful when something is stuck.

```bash
node $OPENCLAW_STATE_DIR/workspace/skills/settings/scripts/settings.mjs reset
```

**Always confirm with the user before running this.** You will restart and lose current conversation context.

### Clear Memory (`/clear-memory`)

Wipe all session history files. Keeps skills, workspace, and config intact — only clears conversation memory.

```bash
node $OPENCLAW_STATE_DIR/workspace/skills/settings/scripts/settings.mjs clear-memory
```

After clearing, confirm to the user that memory has been wiped and you're starting fresh.
