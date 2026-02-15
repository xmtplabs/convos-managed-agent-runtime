# Changelog

## 2026-02-15

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
