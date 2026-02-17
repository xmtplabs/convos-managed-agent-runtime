# Changelog

## 2026-02-17

- Extract NODE_PATH setup into `cli/scripts/lib/node-path.sh`; gateway.sh and qa.sh source it. Document plugin "Cannot find module" workaround in workarounds.mdc.
- **Breaking:** Rename convos extension to convos-sdk. Directory `openclaw/extensions/convos/` → `openclaw/extensions/convos-sdk/`. Plugin and channel id `convos` → `convos-sdk`. Config `channels.convos` → `channels.convos-sdk`. HTTP paths `/convos/*` → `/convos-sdk/*`. Gateway methods `convos.setup` etc. → `convos-sdk.setup` etc. State dir paths `stateDir/convos/` → `stateDir/convos-sdk/`. Migrate config and re-run setup if upgrading.

## 2026-02-16

- README: fix mermaid subgraph id (no leading digit) for pool diagram.
- CLI: rename `start` → `init`, `apply-config` → `apply`; add unified `reset <sessions|chrome>`; document `pnpm cli <cmd>`; README/DESIGN aligned with CLI help; Docker/QA use `pnpm cli apply` and `pnpm cli init`.
- Landing: fix staging/main switch link (staging pointed to dev, now points to main).
- QA: add QA.md with test commands for email, SMS, bankr, search, browser.
- Telnyx integration: add `telnyx-cli` skill to workspace with SMS support. Auto-provision US phone number + messaging profile during `key-provision` via Telnyx API.
- AgentMail inbox provisioning: `key-provision` now creates a unique inbox (`convos-<hex>@agentmail.to`) per agent instead of sharing a hardcoded address.
- Bankr integration: register `bankr` skill in openclaw.json with `BANKR_API_KEY` env var.
- Idempotent provisioning: `key-provision` skips all variables that already exist in `.env` (gateway token, setup password, wallet key, OpenRouter key, inbox, phone number).
- `pnpm start` now runs `key-provision` first, so all keys/services are provisioned before the gateway starts.
- `install-deps`: install `@telnyx/api-cli` globally when telnyx-cli skill is present.
- Dockerfile: remove build-time apply; only run init at CMD. Set OPENCLAW_STATE_DIR=/app earlier.

## 2026-02-15

- Landing moved from convos to web-tools: agents page now at `/web-tools/agents` (still uses convos `/convos/invite` and `/convos/join`). Convos extension no longer serves static landing assets.
- Form moved from workspace to web-tools extension: `form/form.html` now lives in `extensions/web-tools/form/`, served at `/web-tools/form` (no workspace dependency).
- Railway: patch `agents.defaults.workspace` to `$STATE_DIR/workspace` when OPENCLAW_STATE_DIR is set so web-tools form resolves correctly (was using ~/.openclaw/workspace).
- Dockerfile: set OPENCLAW_STATE_DIR=/app at runtime so gateway and apply-config use /app for state.
- Skills: provision inside workspace (`workspace/skills/`). OpenClaw discovers at `<workspace>/skills`. Agentmail script paths use workspace-relative `skills/agentmail/scripts/...`.
- Revert convos extension from CLI-based (@convos/cli) back to SDK-based (@xmtp/agent-sdk + convos-node-sdk).
- apply-config.sh: patch gateway port/bind at deploy time when PORT env var is set (Railway).
- apply-config.sh: merge repo template with existing state config, preserving convos runtime values across restarts.
- Landing: update title to "convos managed agent runtime", center header, add env section with staging/main switch link.

## 2026-02-14

- Landing: treat ngrok hostnames (e.g. *.ngrok.app) as staging for env badge.
- Agentmail: require `$OPENCLAW_STATE_DIR/skills/agentmail/scripts/...` in SKILL.md, TOOLS.md, workarounds (never bare `skills/...` — exec cwd is workspace, avoids MODULE_NOT_FOUND).
- README: add Environment section (vars from .env.example).
- gateway.sh: keep only required exports (OPENCLAW_STATE_DIR, OPENCLAW_CONFIG_PATH, OPENCLAW_WORKSPACE_DIR).
- CLI: rename apply-env-to-config → apply-config, entrypoint → gateway; add `pnpm gateway`.
- CLI: move bootstrap into lib (init.sh, env-load.sh, paths.sh, sync-workspace, sync-skills, config-inject-extensions); entry-point scripts only at top level.
- Single path: only `OPENCLAW_STATE_DIR`; config and workspace paths derived from it.
- Remove skill-setup (no-op); remove from CLI and package.json.
- Config at repo root (`openclaw.json`); Dockerfile copies openclaw.json, workspace, skills (no config-defaults).
- Workarounds and .gitignore updated; add `.openclaw/` to .gitignore.
- Workspace: trim bootstrap files (AGENTS, SOUL, HEARTBEAT, BOOTSTRAP, BOOT, IDENTITY); remove redundancy.

## 2026-02-13

- Remove sub-agents; main agent has full tools (web_search, web_fetch, browser, agentmail).
- Convos: add `/convos/form` and `/convos/form/` routes serving `landing/form.html` (test form page).
- Dockerfile: install Chromium + deps for browser automation; set CHROMIUM_PATH; CMD to `pnpm start`; chmod apply-env script.
- apply-env scripts: inject `browser.executablePath` and `browser.headless=true` from CHROMIUM_PATH into config.
- Cursor workarounds and config/openclaw.json updates.
- Remove smooth-browser skill and TOOL-CONFIG.md.
- Add workspace bootstrap files (AGENTS, SOUL, TOOLS, memory, etc.).

## 2026-02-12

- Landing: two-screen flow — first screen shows "Add agent to existing Convos" and "Create new agent" with divider; second screen (join) has paste input and Join button only.
- Landing: QR center icon 50% smaller; loading state centered; Join button styled like mode buttons; Back button removed.
- Remove Taskfile; add pnpm skill-setup, update bankr doc.
- Workspace and config: docs, rules, workspace path (~/.openclaw/workspace), agentmail scripts, dev gateway on 18789, remove tui script.
- AGENTS.md optimized for group restaurant booking; apply-env and Railway deploy fixes; Tilt core MD files for Convos group chat bookings.
- Remove bankr skill and crypto-subagent.

## 2026-02-11

- Landing: footer copy updated to "Convos Agent. Your Personal AI."
- Landing: show "SPIN UP AGENT" button first; QR code appears only after click instead of auto-fetch on load.
- Convos: enable extension and pin pnpm version; extension updates, smooth-browser skill; env config key XMTP_ENV, default dev.

## 2026-02-10

- e822607 workspace: personal group-chat hint + smooth web automation rule
- 3540508 chore: update Dockerfile, package, entrypoint, workspace docs and cursor rules
- ee36b3d config: apply .env to openclaw.json via standalone script, detach from startup
- 3d01eb8 Skills config via openclaw.json, remove bankr from convos
- 82f974d Add Taskfile.yml and optimize scripts

## 2026-02-09

- d95ce7f first commit
