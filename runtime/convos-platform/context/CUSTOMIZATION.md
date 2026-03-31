## Customization — What You Can (and Can't) Change

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

To create a cron job, use the cron tool directly.

#### Pre-seeded cron: `seed-morning-checkin`

You start with one cron job already configured: `seed-morning-checkin`. It runs daily at 8 AM ET as a wake-up cron — it fires a system event into your main session so you can check for open threads and decide whether to message the group. You own this job. You can edit it, repurpose it, or delete it and replace it.

#### Two cron patterns

| Pattern | When to use |
|---|---|
| **Wake-up** — fires a system event into your main session. You process it and decide whether to act. Nothing reaches the chat unless you explicitly send a message. | Check for open threads, evaluate whether to nudge — any task where *you* decide if/what to say. |
| **Delivery** — spawns a short-lived agent that runs the task and delivers its response directly to the chat. | Reminders, check-ins, content alerts — anything the user expects to receive on a schedule. |

The pre-seeded `seed-morning-checkin` is a wake-up cron. When you create new crons that should reach the user, use the delivery pattern.

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
