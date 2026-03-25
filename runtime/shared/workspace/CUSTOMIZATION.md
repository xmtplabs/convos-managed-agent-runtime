# Customization — What You Can (and Can't) Change

You run inside a managed container. Some parts are yours to extend; others are locked down and rebuilt on every deploy. Know the difference.

## What you CAN create

### Custom skills

Create a skill directory under `$SKILLS_ROOT`:

```
skills/
  my-skill/
    SKILL.md        <- describe what it does, when to use it
    scripts/        <- helper scripts
      check.mjs
    config/         <- any config files (feeds.json, urls.txt, etc.)
```

**Always create a new skill directory** for custom work. Never modify existing core skills (services, convos-runtime, profile-update) — those are platform-managed and overwritten on deploy.

### Choosing the right mechanism

| Need | Use | Why |
|---|---|---|
| **Recurring task** (RSS tracking, price alerts, reminders, scheduled checks) | **Cron job** | Runs on a schedule you define — use for anything the user wants done repeatedly |
| **One-off heavy task** (research, long report) | **Sub-agent** (`sessions_spawn`) | Runs in a background session so you stay responsive |
| **Proactive nudges, catching cracks** | **Heartbeat** | LLM judgment, 30m cycle — **never touch this; it's managed by the platform** |

To create a cron job, use the cron tool directly — just describe the schedule and what you want to happen. Example: "Set up a cron job that runs every morning at 8am to check for open threads."

**Note:** Email and SMS are delivered automatically via webhooks — do not create cron jobs to check for new emails or texts. You'll receive notifications as system messages when they arrive.

Never modify HEARTBEAT.md or add tasks to the heartbeat cycle.

## What you CANNOT change

These are managed by the platform. They get rebuilt or overwritten on every deploy.

| What | Why it's locked |
|---|---|
| **AGENTS.md** | Assembled at boot. Edits are overwritten. |
| **SOUL.md** | Shared personality across all agents. |
| **Core skills** (convos-runtime, services, profile-update) | Versioned with the runtime. Updated via redeploy. |
| **Boot scripts, config, dependencies** | Infrastructure. Managed by the platform. |

### When users ask you to change how you work

- **"Be more formal" / "Talk like a pirate"** — Adapt your tone. No file changes needed; memory and conversation context handle this.
- **"Track this RSS feed"** — Create a cron job to check the feed on a schedule.
- **"Change your core instructions"** — Explain that base instructions are managed and rebuilt on each deploy. You can note preferences in memory and honor them, but you can't rewrite AGENTS.md or SOUL.md.
- **"Install this package"** — Dependencies are baked into the runtime image. Suggest they request it as a platform feature.
