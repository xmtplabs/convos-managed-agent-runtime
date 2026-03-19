# Customization — What You Can (and Can't) Change

You run inside a managed container. Some parts of your workspace are yours to extend; others are locked down and rebuilt on every deploy. Know the difference.

## What you CAN create and modify

### Your own files

These are yours. They persist across restarts on the volume:

- `MEMORY.md` — long-term knowledge about people, decisions, group dynamics
- `USER.md` — quick snapshot of group state
- Any files you create in your workspace (notes, drafts, data files)

### Custom skills with polling hooks

When a user asks you to track, monitor, or periodically check something — RSS feeds, price alerts, API status, website changes, calendar reminders — create a skill with a `poll.sh` hook. Never add these to HEARTBEAT.md or try to handle them in conversation.

Create a skill directory under your workspace skills folder:

```
skills/
  my-tracker/
    SKILL.md        <- describe what it does, when to use it
    poll.sh         <- poller auto-discovers and runs this every 60s
    scripts/        <- helper scripts called by poll.sh
      check.mjs
    config/         <- any config files (feeds.json, urls.txt, etc.)
```

The `poll.sh` contract:
- Prints text to stdout -> poller sends it as a group notification
- Prints nothing -> silent, no notification sent
- Errors (stderr) -> logged by poller, never sent to group
- Must be a valid shell script (sh-compatible)
- Has access to `$SKILLS_ROOT` and all env vars the poller inherits

### Separation of concerns

| Mechanism | Purpose | LLM? | Frequency |
|---|---|---|---|
| **Poller + poll.sh** | Mechanical data checks (email, SMS, RSS, any user skill) | No | 60s cycle |
| **Heartbeat** | Judgment calls — nudges, scribing, catching cracks | Yes | 30m |

The poller does cheap, frequent, mechanical work. The heartbeat is for things that need LLM judgment. Never mix them.

## What you CANNOT change

These files are managed. They get rebuilt or overwritten on every deploy. Don't modify them — your changes will be lost.

| File | Why it's locked |
|---|---|
| **AGENTS.md** | Assembled from shared base + runtime extra at boot. Edits are overwritten. |
| **SOUL.md** | Shared personality across all agents. Repo-level changes only. |
| **Core skills** (convos-cli, convos-runtime, services, bankr) | Versioned with the runtime. Updated via redeploy, not local edits. |
| **Boot scripts and config** | Infrastructure. Managed by the platform. |

### When users ask you to change how you work

Users may ask you to change your personality, instructions, or behavior. Here's what you can do:

- **"Be more formal" / "Talk like a pirate"** — You can adapt your tone within a conversation. You don't need to change any files for this; your instructions and memory already guide your behavior.
- **"Track this RSS feed every hour"** — Create a custom skill with poll.sh. This is what customization is for.
- **"Stop using the bankr skill"** — You can choose not to invoke a skill. You don't need to delete or modify it.
- **"Change your core instructions"** — Explain that your base instructions are managed by the platform and rebuilt on each deploy. You can note preferences in MEMORY.md and honor them, but you can't rewrite AGENTS.md or SOUL.md.
- **"Install this npm package"** — Dependencies are baked into the runtime image. Suggest they request it as a platform feature if it's something they need.
