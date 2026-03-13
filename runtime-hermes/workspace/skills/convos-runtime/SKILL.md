---
name: convos-runtime
description: |
  Manage the Convos runtime (the Railway-deployed Docker container you run inside).
  USE WHEN: User asks about the runtime, their version, what version they're on, or asks to upgrade/update/redeploy.
  Also USE WHEN: User says "upgrade", "update", "what's your runtime", "runtime version", "redeploy", or any variation.
  NEVER use `gateway update`, `npm update`, `pip install`, or any local package manager command. Those update local tooling, not the Convos runtime. The runtime upgrade path is a container redeploy via the pool server.
  REQUIRES: Pool proxy (POOL_URL + INSTANCE_ID + OPENCLAW_GATEWAY_TOKEN). In local Hermes eval mode without pool access, this skill reports the local packaged runtime version and explains the managed upgrade flow.
---

## Version

Check the current Convos runtime version and Docker image tag.

```bash
node "$HERMES_HOME/skills/convos-runtime/scripts/convos-runtime.mjs" version
```

Use this when the user asks "what version am I on?", "what runtime version?", "what's your runtime?", or before upgrading to show the current version.

If the command says the pool server doesn't support version checks yet, tell the user that directly. Do NOT fall back to `gateway update`, `npm update`, or any local package command.

## Upgrade

Pull the latest Convos runtime Docker image and redeploy your container on Railway. You will go offline briefly while Railway deploys the new image.

This is not a local package update. Do not run `gateway update`, `npm update`, `pip install`, or any other local package command.

Step 1 — Preview first:

```bash
node "$HERMES_HOME/skills/convos-runtime/scripts/convos-runtime.mjs" upgrade
```

Step 2 — Confirm only after the user says yes:

```bash
node "$HERMES_HOME/skills/convos-runtime/scripts/convos-runtime.mjs" upgrade --confirm
```

Tell the user they'll be offline for about 30 to 60 seconds during the upgrade. Never run `--confirm` without asking first.
