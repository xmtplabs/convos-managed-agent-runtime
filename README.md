# convos-managed-agent-runtime

OpenClaw gateway + Convos (XMTP) channel plugin. Single agent, managed config.

## Stack

- **OpenClaw** — gateway, agents, sessions, tools
- **Convos extension** — XMTP channel plugin (DMs, groups, reactions)

## Layout

Each `openclaw/` subdir syncs into `~/.openclaw/` (or `OPENCLAW_STATE_DIR`) at apply time:

| Path | Contents |
|------|----------|
| `openclaw/workspace` | AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, HEARTBEAT.md, BOOT.md, USER.md |
| `openclaw/skills` | agentmail (email skill) |
| `openclaw/extensions` | convos (XMTP channel plugin) |
| `openclaw/landing` | landing.html, form.html, sw.js, manifest, icon |
| `openclaw/openclaw.json` | Config template (env-substituted → `~/.openclaw/openclaw.json`) |
| `cli/` | apply-config, gateway, install-state-deps scripts |

## Usage

```bash
pnpm run key-provision      # Generate keys, write .env
pnpm run apply-config       # Sync openclaw/ → state dir, apply .env to config
pnpm run install-state-deps # Install extension/skill deps
pnpm run gateway            # Start the gateway
pnpm start                  # apply-config + gateway
```

## Flow

1. **apply-config** — Syncs `openclaw/workspace`, `skills`, `extensions`, `landing` into `OPENCLAW_STATE_DIR`, substitutes `.env` into `openclaw.json`
2. **gateway** — Runs OpenClaw with `OPENCLAW_CONFIG_PATH` and injected plugin paths

No core OpenClaw changes. Convos lives entirely in the plugin.
