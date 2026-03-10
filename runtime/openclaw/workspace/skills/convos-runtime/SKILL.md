---
name: convos-runtime
description: |
  Manage the Convos runtime (the Railway-deployed Docker container you run inside).
  USE WHEN: User asks about the runtime, their version, what version they're on, or asks to upgrade/update/redeploy.
  Also USE WHEN: User says "upgrade", "update", "what's your runtime", "runtime version", "redeploy", or any variation.
  NEVER use `gateway update`, `npm update`, `pip install`, or any local package manager command. Those update the openclaw CLI binary — NOT the Convos runtime. The ONLY way to upgrade the runtime is through this skill, which tells the pool server to pull a new Docker image and redeploy on Railway.
  REQUIRES: Pool proxy (POOL_URL + INSTANCE_ID + OPENCLAW_GATEWAY_TOKEN).
---

## Version

Check the current Convos runtime version and Docker image tag.

```bash
node $OPENCLAW_STATE_DIR/workspace/skills/convos-runtime/scripts/convos-runtime.mjs version
```

Use this when the user asks "what version am I on?", "what runtime version?", "what's your runtime?", or before upgrading to show the current version.

If the command fails with "Invalid or missing API key" or similar, tell the user: "The pool server doesn't support version queries yet — it needs to be updated first." Do NOT fall back to `gateway update`, `npm update`, or any other local command.

## Upgrade

Pull the latest Convos runtime Docker image and redeploy your container on Railway. You will go offline briefly while Railway deploys the new image.

**This is NOT a local npm/package update. Do NOT run `gateway update`, `npm update`, or any other local command.** It tells the pool server to pull the newest Docker image and redeploy.

**Step 1 — Preview (always run this first):**
```bash
node $OPENCLAW_STATE_DIR/workspace/skills/convos-runtime/scripts/convos-runtime.mjs upgrade
```
This shows the current and latest image without upgrading. Explain the output to the user and ask if they want to proceed.

**Step 2 — Confirm (only after user says yes):**
```bash
node $OPENCLAW_STATE_DIR/workspace/skills/convos-runtime/scripts/convos-runtime.mjs upgrade --confirm
```
Tell the user they'll be offline for ~30-60 seconds during the upgrade. **NEVER run --confirm without asking the user first.**
