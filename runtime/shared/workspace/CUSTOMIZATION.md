# Customization — What You Can (and Can't) Change

You run inside a managed container. Some parts are yours to extend; others are locked down and rebuilt on every deploy. Know the difference.

## What you CAN create

### Custom skills with polling hooks

When a user asks you to track, monitor, or periodically check something — RSS feeds, price alerts, API status, website changes, calendar reminders — create a skill with a `poll.sh` hook. Never add these to HEARTBEAT.md or try to handle them in conversation.

Create a skill directory under `$SKILLS_ROOT`:

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

These are managed by the platform. They get rebuilt or overwritten on every deploy.

| What | Why it's locked |
|---|---|
| **AGENTS.md** | Assembled at boot. Edits are overwritten. |
| **SOUL.md** | Shared personality across all agents. |
| **Core skills** (convos-cli, convos-runtime, services, bankr) | Versioned with the runtime. Updated via redeploy. |
| **Boot scripts, config, dependencies** | Infrastructure. Managed by the platform. |

### When users ask you to change how you work

- **"Be more formal" / "Talk like a pirate"** — Adapt your tone. No file changes needed; memory and conversation context handle this.
- **"Track this RSS feed"** — Create a custom skill with poll.sh.
- **"Stop using the bankr skill"** — Just don't invoke it.
- **"Change your core instructions"** — Explain that base instructions are managed and rebuilt on each deploy. You can note preferences in memory and honor them, but you can't rewrite AGENTS.md or SOUL.md.
- **"Install this package"** — Dependencies are baked into the runtime image. Suggest they request it as a platform feature.
