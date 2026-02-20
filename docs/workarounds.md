# Convos-agent workarounds

Documented workarounds so future changes don't break them or duplicate logic.

## Memory slot: use "none" when memory-core is not present

**Problem:** Default OpenClaw config can set `plugins.slots.memory` to `memory-core`. If that extension isn't shipped (e.g. convos-agent Docker image, or minimal dev setup), config validation fails with "plugin not found: memory-core" (see openclaw/openclaw#8909).

**Workaround:** In [openclaw/openclaw.json](openclaw/openclaw.json), set `plugins.slots.memory` to `"none"` so no memory extension is required. `pnpm cli apply` syncs this file into the state dir.

## Extension id must match package/manifest

**Problem:** If package.json `name` is e.g. `@scope/openclaw-plugin-convos`, OpenClaw derives id `openclaw-plugin-convos`. If openclaw.plugin.json or channel config says `convos`, you get "plugin id mismatch".

**Workaround:** Use a single id everywhere: set package.json `"name": "@openclaw/convos"` and openclaw.plugin.json `"id": "convos"` (and channel id `convos`). No scoped name for the extension package in this repo.

## Extension deps in OPENCLAW_STATE_DIR

**Problem:** Extensions need node_modules. OpenClaw loads extensions from the state dir.

**Workaround:** Run `pnpm cli install-deps` after `pnpm cli apply`. [cli/scripts/install-deps.sh](cli/scripts/install-deps.sh) runs `pnpm install` in each `$OPENCLAW_STATE_DIR/extensions/*` directory. Run manually when setting up or after syncing.

## Plugin "Cannot find module" / extension deps resolution

**Problem:** Plugins (e.g. convos) that depend on npm packages fail at load with `Cannot find module` or `ERR_PACKAGE_PATH_NOT_EXPORTED`. OpenClaw's jiti loader resolves `require()` from Node's default search path; extension code lives under `STATE_DIR/extensions/*` whose `node_modules` Node does not search by default.

**Workaround:** [cli/scripts/lib/node-path.sh](cli/scripts/lib/node-path.sh) builds NODE_PATH from `ROOT/node_modules` (all deps — agentmail, @xmtp/convos-cli, openclaw, etc.) and adds `ROOT/node_modules/.bin` to PATH (CLI tools — telnyx, bankr). All skill and extension deps are root dependencies in `package.json`. [gateway.sh](cli/scripts/gateway.sh) and [qa.sh](cli/scripts/qa.sh) source this helper.

## Registered vs script-based skills: only use `alsoAllow` for registered tools

**Problem:** There are two kinds of skills:
- **Registered skills** have a `_meta.json` in their workspace dir. These are recognized by OpenClaw's tool system and can be referenced in `alsoAllow`/`deny`.
- **Script-based skills** have only `scripts/` and `SKILL.md` (e.g. `agentmail`). These are invoked via `exec` (running shell/node scripts). They are **not** registered as named tools — putting them in `alsoAllow` or `deny` triggers "unknown entries" warnings or is silently ignored.

Using `tools.allow` for a skill name (when the skill has no `_meta.json`) makes it "unknown" and can cause OpenClaw to ignore the allowlist. Use `tools.allow` only for core tool names (e.g. `browser`).

**Workaround:** In [openclaw/openclaw.json](openclaw/openclaw.json):

1. **`alsoAllow` only for registered skills** — only put skill names in `tools.alsoAllow` if the skill has a `_meta.json`. Never use `tools.allow` for skill names (use it for core tools like `browser`).
2. **Script-based skills need no tool config** — `agentmail` works via `exec`. The agent's profile must include `exec` access; no `alsoAllow` entry is needed. Env vars are injected via `skills.entries.*.env`.
3. **Main agent has full tool access** — browser, agentmail, web_search, web_fetch; no per-agent allow/deny for those.
4. **Deny only registered tools** — when you add a registered skill, deny it on agents that shouldn't use it. Don't deny script-based skill names (no effect).

## CAUTON:

    PRIVATE_WALLET_KEY does othing to do witgh Convos!

## Skill script paths: use explicit state dir path

**Context:** Skills are provisioned under workspace (`openclaw/workspace/skills/`). OPENCLAW_STATE_DIR is set by the gateway.

**Workaround:** Run `node $OPENCLAW_STATE_DIR/workspace/skills/agentmail/scripts/<script>.mjs ...`. SKILL.md and TOOLS.md state this so the agent gets the right path.

## Skill deps: root dependencies

**Context:** Skill deps (agentmail, @telnyx/api-cli, @bankr/cli) are declared in the root `package.json` like any other dependency. `node-path.sh` adds `ROOT/node_modules/.bin` to `PATH` so CLI tools (`bankr`, `telnyx`) resolve.

**ESM caveat:** Skill scripts run from `~/.openclaw/workspace/skills/...` and use ESM `import`. Unlike CommonJS `require()`, ESM does **not** respect `NODE_PATH` — it only walks up from the importing file's location. Since the state dir is a different tree from `ROOT/node_modules`, ESM can't find root deps. `install-deps.sh` fixes this by symlinking JS library deps (e.g. `agentmail`) from `ROOT/node_modules` into `STATE_DIR/node_modules`.

**To add a new skill dep:** add it to root `package.json`, run `pnpm install`. If the skill uses ESM `import` (not a CLI), also add the package name to the `SKILL_LIBS` list in `install-deps.sh`.

## openclaw dependency in extension (no workspace)

**Problem:** Extension has `openclaw` in devDependencies for types/sdk. In convos-agent there is no OpenClaw workspace, so `workspace:*` fails on install.

**Workaround:** In [openclaw/extensions/convos/package.json](openclaw/extensions/convos/package.json), use `"openclaw": "workspace:*"` so install works; at runtime OpenClaw's loader provides the plugin-sdk. In Docker, [Dockerfile](Dockerfile) sed replaces `"openclaw": "workspace:*"` with `"openclaw": "file:/openclaw"` so the image resolves openclaw from the built /openclaw copy.

## Browser on Railway / headless (target + targetUrl)

**Problem:** On Railway (or when `CHROMIUM_PATH` is set / headless), the browser tool can fail with "Sandbox browser is unavailable", "targetUrl required", or "Can't reach the OpenClaw browser control service (Error: fields are required)". The model may call the browser tool with incomplete params.

**Workaround (instructions):** In [openclaw/workspace/TOOLS.md](openclaw/workspace/TOOLS.md), a callout under the Browser bullet instructs: in headless/cloud use `target: "host"`; for `navigate` always pass `targetUrl` with the full URL; for other actions pass all required params (e.g. `ref` for `act`). Do not remove or shorten this callout — it fixes "targetUrl required" and "fields are required" errors.

**Workaround (CDP timeouts):** Chrome cold-start can exceed the default CDP timeout, causing "tab not found". In [openclaw/openclaw.json](openclaw/openclaw.json), `remoteCdpTimeoutMs` is set to `5000` and `remoteCdpHandshakeTimeoutMs` to `8000` (up from 1500/3000). Do not lower these — they prevent race conditions when Chrome is starting up.

## Control UI / webchat: replies only after refresh

**Problem:** In the Control UI (webchat), agent replies sometimes do not appear until the page is refreshed. The gateway run completes (logs show `run_completed`, `run done`), but the client does not receive or render the reply over the live connection.

**Workaround:** Refresh the page to load the latest session state and see the reply. This is a known limitation in the OpenClaw core webchat/Control UI delivery path (gateway → WebSocket → client); fixing it requires changes in the main OpenClaw repo, not in this extension repo.

**Config:** [openclaw/openclaw.json](openclaw/openclaw.json) sets `agents.defaults.blockStreamingDefault: "on"` so the gateway sends reply blocks as they are ready; some clients may need this to update the UI. If the issue persists, the fix must be in core (session key resolution, WebSocket event delivery, or Control UI subscription).
