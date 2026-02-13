# Changelog


## 2026-02-13

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
- Convos: enable plugin and pin pnpm version; extension updates, smooth-browser skill; env config key XMTP_ENV, default dev.

## 2026-02-10

- e822607 workspace: personal group-chat hint + smooth web automation rule
- 3540508 chore: update Dockerfile, package, entrypoint, workspace docs and cursor rules
- ee36b3d config: apply .env to openclaw.json via standalone script, detach from startup
- 3d01eb8 Skills config via openclaw.json, remove bankr from convos
- 82f974d Add Taskfile.yml and optimize scripts

## 2026-02-09

- d95ce7f first commit
