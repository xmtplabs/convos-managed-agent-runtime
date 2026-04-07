---
name: convos-runtime
description: |
  Manage the Convos runtime (the Railway-deployed Docker container you run inside).
  USE WHEN: User asks about the runtime, their version, what version they're on, or asks to upgrade/update/redeploy.
  Also USE WHEN: User says "upgrade", "update", "what's your runtime", "runtime version", "redeploy", or any variation.
  Also USE WHEN: User asks for their URL, link, page, services page, logs link, or anything about their public-facing address.
  NEVER use `gateway update`, `npm update`, `pip install`, or any local package manager command. Those update local tooling, not the Convos runtime. The runtime upgrade path is a container redeploy via the pool server.
  REQUIRES: Pool proxy (POOL_URL + INSTANCE_ID + GATEWAY_TOKEN).
---

## Info

Check your public URLs (services page, logs page) and what services are provisioned:

```bash
node "$SKILLS_ROOT/services/scripts/services.mjs" info
```

Returns JSON: `{ email, phone, servicesUrl, logsUrl }`

**You MUST run this command when someone asks:**
- "what's your URL / link / page"
- "share your services / contact info"
- "can I see your services"
- anything about your public-facing address or dashboard

The `servicesUrl` is your public services page. The `logsUrl` is the logs/trajectories page. Always share these as-is — never make up a URL.

## Version

Check the current Convos runtime version and Docker image tag.

```bash
node "$SKILLS_ROOT/convos-runtime/scripts/convos-runtime.mjs" version
```

Use this when the user asks "what version am I on?", "what runtime version?", "what's your runtime?", or before upgrading to show the current version.

If the command fails with "Invalid or missing API key" or similar, tell the user: "The pool server doesn't support version queries yet — it needs to be updated first." Do NOT fall back to `gateway update`, `npm update`, or any other local command.

## Upgrade

Pull the latest Convos runtime Docker image and redeploy your container on Railway. You will go offline briefly while Railway deploys the new image.

This is not a local package update. Do not run `gateway update`, `npm update`, `pip install`, or any other local package command.

Step 1 — Preview first:

```bash
node "$SKILLS_ROOT/convos-runtime/scripts/convos-runtime.mjs" upgrade
```

This shows the current and latest image without upgrading.

Step 1b — Changelog (show what changed):

```bash
curl -s https://raw.githubusercontent.com/xmtplabs/convos-agents/dev/runtime/CHANGELOG.md
```

Fetch the changelog and summarize what's new since the user's current version. Show the user what they'll get before asking to confirm.

Step 2 — Confirm only after the user says yes:

```bash
node "$SKILLS_ROOT/convos-runtime/scripts/convos-runtime.mjs" upgrade --confirm
```

Tell the user they'll be offline for about 30 to 60 seconds during the upgrade. Never run `--confirm` without asking first.

### Examples

"What version are you on?"
BAD: "I'm on version 2.1." (from memory, without checking)
GOOD: [runs convos-runtime.mjs version] → "I'm on v2.3.1."

"Upgrade yourself."
BAD: [runs `npm update` or `gateway update`]
GOOD: [runs convos-runtime.mjs upgrade] → shows current vs latest, summarizes changelog, asks to confirm.

"What's your URL?"
BAD: "My URL is https://convos.org/agent/abc." (fabricated)
GOOD: [runs services.mjs info] → shares the real servicesUrl.
