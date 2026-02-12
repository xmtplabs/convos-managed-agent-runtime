# Tool Configuration

How OpenClaw tool access is configured for each agent in this project.

## Architecture

```
Global (tools section)
  profile: full          -- baseline for all agents
  deny: [group:ui]       -- blocks native browser + canvas everywhere

main-agent (Concierge)
  inherits: full profile
  no tool overrides      -- delegates to subagents for skills
  can spawn: browser-automation-subagent, email-subagent, crypto-subagent

browser-automation-subagent (Web Automation)
  profile: coding        -- fs, runtime, exec, sessions
  alsoAllow: smooth-browser  (registered tool with _meta.json)

email-subagent (Email Agent)
  profile: messaging     -- messaging tools only
  deny: smooth-browser
  uses agentmail via exec (script-based skill, no alsoAllow needed)

crypto-subagent (Crypto Agent)
  profile: minimal
  deny: smooth-browser
  uses bankr via exec (script-based skill, no alsoAllow needed)
```

## Registered vs script-based skills

| Skill | Type | Has `_meta.json` | How it's used | In `alsoAllow`? |
|---|---|---|---|---|
| `smooth-browser` | Registered tool | Yes | Dedicated tool API | Yes — must be in `alsoAllow` |
| `agentmail` | Script-based | No | `exec` runs `node workspace/skills/agentmail/scripts/*.mjs` | No — would trigger "unknown entries" warning |
| `bankr` | Script-based | No | `exec` runs `workspace/skills/bankr/scripts/*.sh` | No — would trigger "unknown entries" warning |

**Key rule:** Only put skill names in `alsoAllow`/`deny` if the skill has a `_meta.json` in its workspace directory. Script-based skills work through `exec` and need no tool-level config.

## Profiles

| Profile | What it includes | Used by |
|---|---|---|
| `full` | All core tools (fs, runtime, exec, sessions, web, etc.) | main-agent |
| `coding` | fs, runtime, exec, sessions | browser-automation-subagent |
| `messaging` | Messaging/email tools only | email-subagent |
| `minimal` | Minimal tool set | crypto-subagent |

## Global deny: `group:ui`

The native `browser` and `canvas` tools are blocked globally via `"deny": ["group:ui"]`. We use `smooth-browser` (a registered skill) for web automation instead — the native browser requires a local Chrome install which isn't available in production.

## How to add a new skill

1. Add the skill entry in `config/openclaw.json` under `skills.entries` (with env vars)
2. Check if the skill has a `_meta.json` in its workspace directory:
   - **If yes (registered tool):** Add the skill name to the appropriate agent's `tools.alsoAllow`, and to other agents' `tools.deny`
   - **If no (script-based):** No `alsoAllow`/`deny` changes needed. Ensure the agent's profile includes `exec` access so it can run the scripts.
3. Run `pnpm apply` and check for warnings

## How to add a new subagent

1. Add the agent entry in `agents.list` with an appropriate `tools.profile`
2. For registered skills: add to `alsoAllow`, deny others' registered skills
3. Add the agent ID to `main-agent`'s `subagents.allowAgents`
4. Run `pnpm apply` and verify `sessions_spawn` works from main-agent

## Verification

After any config change:

1. `pnpm apply` should produce no warnings
2. Gateway logs should show no "unknown entries" or "ignoring allowlist" messages
3. Main agent can spawn all listed subagents
4. Each subagent can only access its allowed tools
