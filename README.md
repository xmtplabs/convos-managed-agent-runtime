# convos-managed-agent-runtime

Managed runtime that runs the **OpenClaw** gateway with a **Convos (XMTP)** channel plugin and a single main agent. Thin wrapper: config + entrypoint + one custom extension.

## Core stack

- **OpenClaw** (`openclaw` npm) — gateway, agents, sessions, tools.
- **Convos extension** — OpenClaw plugin adding the **Convós** channel (XMTP-based, E2E encrypted).
- **Agentmail** — optional skill dependency (email) used from the workspace.

## Repo layout

| Area | Purpose |
|------|--------|
| **`config/`** | Default `openclaw.json` template (gateway, agents, channels, models). Env vars like `${OPENCLAW_PRIMARY_MODEL}` are applied at runtime. |
| **`workspace/`** | Agent “brain”: `AGENTS.md`, `SOUL.md`, `TOOLS.md`, `IDENTITY.md`, `HEARTBEAT.md`, `BOOT.md`, plus **`workspace/skills/`** (e.g. agentmail). Seeded/copied into the runtime workspace by entrypoint and apply script. |
| **`extensions/convos/`** | The only custom plugin: Convos channel + setup/reset RPC and slash commands. |
| **`scripts/`** | Bootstrap: env load, config apply, entrypoint, upgrade, skill-setup, OpenRouter key, extension deps. |
| **`cli/`** | Optional CLI/helpers (e.g. `sync-extensions.sh`). |
| **`landing/`** | Static landing/form HTML. |

## Runtime flow (entrypoint)

1. **Env** — `scripts/env-load.sh` (e.g. `.env`).
2. **Tenant overlay** — If missing, copy `config/openclaw.json` → `OPENCLAW_STATE_DIR/openclaw.json`.
3. **Agent brain** — Ensure workspace dir exists; on first run or version bump, copy/update `SOUL.md`, `AGENTS.md`, `IDENTITY.md`, `TOOLS.md`, `workspace/skills/` from repo into that workspace; write `.deployed-version`.
4. **Gateway token** — From `OPENCLAW_GATEWAY_TOKEN`, or `gateway.token` file, or generate and persist.
5. **Config patch** — jq: set `gateway.port`, `gateway.bind=lan`, auth token, `agents.defaults.workspace`.
6. **Plugins** — Run `install-extension-deps.sh` if present; inject `plugins.load.paths` so OpenClaw loads `extensions/` (e.g. `OPENCLAW_CUSTOM_PLUGINS_DIR` or `$ROOT/extensions`).
7. **OpenRouter** — Optional: `openrouter-ensure-key.sh` for per-deploy API key.
8. **Skill setup** — `skill-setup.sh` (e.g. merge env into `skills.entries`).
9. **Start** — `openclaw gateway run` on the chosen port with token auth.

`apply-env-to-config.sh` (and `.cjs`) does env→config substitution, plugin path injection, optional Chromium path, and can sync workspace bootstrap + skills from repo and set `agents.defaults.workspace` to the repo workspace when `OPENCLAW_USE_REPO_WORKSPACE` is set.

## Convos extension (`extensions/convos/`)

- **Plugin entry:** `index.ts` — registers channel, gateway methods, and setup lifecycle.
- **Channel:** `src/channel.ts` — Convos as OpenClaw channel plugin: routing, inbound pipeline, outbound delivery, capabilities (groups, reactions; no threads/media), onboarding adapter.
- **XMTP/Convos:** `sdk-client.ts`, `outbound.ts`, `lib/convos-client.ts`, `lib/identity.ts`, `lib/identity-store.ts` — client lifecycle, send/receive, identity and DB path.
- **Config & accounts:** `accounts.ts`, `config-schema.ts`, `config-types.ts` — `channels.convos.accounts`, resolve account, default account.
- **Setup:** `setup.ts`, `onboarding.ts` — invite-based setup, join flow; `index.ts` holds setup agent and gateway methods: `convos.setup`, `convos.setup.status`, `convos.setup.complete`, `convos.setup.cancel`, `convos.reset`.
- **Commands:** `convos-commands.ts` — slash commands (e.g. invite creation) registered with OpenClaw.
- **Actions:** `actions.ts` — Convos message actions (e.g. react).

**No core OpenClaw code is modified;** everything lives in the plugin.

## Agent model

- Single main agent (`agents.list`: one default, id e.g. `main-agent`) with workspace and tool policy (e.g. deny `web_search`, `web_fetch`, `browser`, `agentmail` as configured).
- Optional subagents in config; routing is channel/account-based.
- Models: OpenRouter-backed; primary and list come from config (env-substituted).

## Deployment / Docker

- **Dockerfile** — Builds an image that can use `config-defaults` / `workspace-defaults` instead of `config/` and `workspace/` for tenant-specific or image-default content.
- **State:** `OPENCLAW_STATE_DIR` (or e.g. `RAILWAY_VOLUME_MOUNT_PATH`) holds config, workspace copy, gateway token, and Convos/XMTP state (identity, DB).
- **Port:** `OPENCLAW_PUBLIC_PORT` or `PORT` (default 18789); gateway bound to `0.0.0.0` in entrypoint.

---

**TL;DR:** OpenClaw gateway + one Convos (XMTP) channel plugin; config and agent brain are managed by scripts and optional Docker; no changes to OpenClaw core.
