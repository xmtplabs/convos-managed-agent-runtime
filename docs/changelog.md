# Changelog

## 0.0.15 — 2026-02-25

- **Merge services into pool.** Services is no longer a separate directory or HTTP service — provider modules (Railway, OpenRouter, AgentMail, Telnyx) now live at `pool/src/services/` and are imported directly. Single process, single Postgres database, single Dockerfile. All inter-service HTTP calls replaced with direct function imports.
- **TypeScript migration.** Pool codebase converted from JavaScript to TypeScript. New `pool/tsconfig.json`, all `.js` files replaced with `.ts` equivalents.
- **Unified config.** Single `pool/src/config.ts` replaces separate pool and services env configs. One `DATABASE_URL` for all three tables (`instances`, `instance_infra`, `instance_services`).
- **Admin: stateless auth + credits.** Admin dashboard uses HMAC-based stateless session tokens (no server-side session store). OpenRouter credit balance shown in dashboard.
- **Admin: orphan cleanup.** Dashboard can detect and clean up orphaned Railway services that exist in Railway but not in the pool DB.
- **Drain/kill deletes Railway services.** `POST /api/pool/drain` and `DELETE /api/pool/instances/:id` now fully destroy Railway services and provisioned tools, not just remove pool DB rows.
- **Docs:** Updated README, pool README, and `docs/schema.md` to reflect unified architecture. Removed stale `docs/design.md` and `docs/runtime.md`.

## 0.0.14 — 2026-02-25

- **Pool/Services DB separation.** Pool `instances` table trimmed to identity + claim state only (10 columns). Infra details (service IDs, deploy status, volumes, images, tool resources) live in separate tables (`instance_infra` + `instance_services`). Pool no longer stores `service_id`, `deploy_status`, `volume_id`, `runtime_image`, `openrouter_key_hash`, `agentmail_inbox_id`, `gateway_token`, or `source_branch`.
- **Pool: id-based operations.** All DB operations (upsert, claim, status, delete, orphan cleanup) now key on `instances.id` instead of `service_id`. Tick loop reconciles by `instanceId` from batch status.
- **`provider_project_id`.** New column on `instance_infra` for future per-agent Railway projects. Backfilled from `RAILWAY_PROJECT_ID`. Returned as `projectId` in `/status/batch` response.
- **Pool: dashboard enrichment.** `/api/pool/agents` fetches batch status and joins `serviceId` + `projectId` into the response. Railway links in the dashboard now work via enriched batch data instead of hardcoded env vars. Graceful degradation if batch status fails.
- **Migration: `--drop` flag.** `pnpm db:migrate:drop` drops legacy columns. Normal `pnpm db:migrate` is safe — only creates tables, adds columns, backfills.
- **Remove enrich script.** Delete `pool/src/db/enrich-instances.js` and `db:enrich` script — no longer needed with infra data in dedicated tables.
- **Remove unused `runtime/scripts/lib/db.mjs`.**

## 0.0.13 — 2026-02-25

- **Pool: DB-backed instance state.** Replace in-memory cache with Postgres `instances` table. All instance state (status, urls, keys, metadata) persisted in DB. Atomic claiming via `FOR UPDATE SKIP LOCKED`. Tick loop reconciles DB with Railway on every cycle. Delete `cache.js`.
- **Pool: enrich script.** Add `pnpm db:enrich` to backfill existing instances from Railway API (url, deploy_status, gateway_token, agentmail_inbox_id, runtime_image). Supports `--dry-run` and `--all` flags. Works across environments via `RAILWAY_ENVIRONMENT_NAME`.
- **Pool: Railway API helpers.** Add `getServiceVariables()` (fetch env vars), `getServiceImage()` (fetch source image), `resolveEnvironmentId()` (resolve env name to ID).
- **Pool: runtime_image tracking.** New `runtime_image` column records which Docker image each instance was deployed from.
- **Pool: migration.** Migrate `agent_metadata` rows into `instances` table with Railway API enrichment for url, deploy_status, gateway_token.

## 0.0.12 — 2026-02-20

- **Convos: agent serve migration.** Rewrite convos extension from two child processes (`conversation stream` + `process-join-requests --watch`) to a single `convos agent serve` process with ndjson stdin/stdout protocol. Operations (send, react, rename, lock, unlock, explode) now go through stdin commands instead of separate CLI exec calls. Self-echo filtering handled by CLI, not JS.
- **Debug instrumentation.** Restore debug logging lost in the agent serve migration: `writeCommand` logs stdin commands, `handleEvent` logs all received ndjson events, `start()` logs on ready. stderr from the child process is always logged (not gated by debug flag).
- **Gateway cleanup.** Kill old `gateway.sh` wrapper scripts (not just `openclaw-gateway` processes) before starting a new gateway. Prevents the old script's restart loop from respawning a competing gateway.
- **Dependencies.** Drop `openclaw` devDependency from convos and web-tools extensions (resolves from root). Move `ethers` from devDependencies to dependencies. Remove `devDependencies` section from root package.json.

## 0.0.11 — 2026-02-20

- **Dependencies:** Move all skill deps (agentmail, @telnyx/api-cli, @bankr/cli) to root `package.json`. No more global installs or state-dir package.json workarounds. CLIs resolve via PATH (`node-path.sh` adds `ROOT/node_modules/.bin`); JS libraries (agentmail) symlinked into state dir for ESM resolution.
- **install-deps.sh:** Simplified — only handles extensions and ESM symlinks. Removed NODE_ENV=development override, extension root loop, agentmail state-dir install, telnyx/bankr global installs.
- **node-path.sh:** Adds `ROOT/node_modules/.bin` to PATH for CLI tools. Removed extension root loop (convos-cli is now a root dep).
- **pool:** Remove `NODE_ENV=development` override from pool instance env vars (no longer needed).
- **Convos reset:** Fix `/convos/reset` not clearing the running instance. Status showed "bound" after reset because the in-memory ConvosInstance was never stopped. Now stops the instance and clears it before re-running setup.
- **TOOLS.md:** Skill examples now show `exec:` with actual commands instead of bare skill names (`agentmail`, `bankr`, `telnyx`). Prevents weaker models (GPT/Groq) from trying to call skills as tool names.
- **QA:** Fix bankr grep pattern (`USDC` → `USD` to match broader responses).
- **Docs:** Consolidate workarounds.md — merge three overlapping dep sections into one table, remove noise.

## 2026-02-18

- **Changelog:** Document convos CLI and pool manager integration from commit history.
- **Convos CLI:** Integrated into runtime CLI. `pnpm cli reset convos` resets convos identity (server-side QR, UI, CLI build). Identity stored in credentials dir (not openclaw.json); persisted on Railway volume. Reset identity button in convos agents UI. @convos/cli installed globally from state dir with NODE_PATH resolution; node-path.sh used by gateway.sh and qa.sh.
- **Pool manager:** Integrated into monorepo under `pool/`. `pool-server.js` is the agnostic container entrypoint for pool-managed instances. Claim API generates gateway token per instance and returns it in the claim response. Provision uses convos invite/join pattern; health check verifies convos readiness. `POST /pool/restart-gateway` for fast gateway restart. QA workflow dogfoods pool API for health check. Auth: POOL_API_KEY replaced by SETUP_PASSWORD; convos routes protected by gateway auth.
- **CLI:** Add `openrouter-clean` command to delete all OpenRouter API keys (#54).
- **Docs:** Convos extension doc, README pointer to docs/ (design, QA, pool, convos-extension, workarounds), pool and QA workflow (#55). README title simplified to "Convos agents".

## 2026-02-17

- CLI: rename program name from convos to runtime; remove convos→convos-sdk migration from sync-openclaw.
- Extract NODE_PATH setup into `cli/scripts/lib/node-path.sh`; gateway.sh and qa.sh source it. Document plugin "Cannot find module" workaround in docs/workarounds.md.
- **Breaking:** Rename convos extension to convos-sdk. Directory `openclaw/extensions/convos/` → `openclaw/extensions/convos-sdk/`. Plugin and channel id `convos` → `convos-sdk`. Config `channels.convos` → `channels.convos-sdk`. HTTP paths `/convos/*` → `/convos-sdk/*`. Gateway methods `convos.setup` etc. → `convos-sdk.setup` etc. State dir paths `stateDir/convos/` → `stateDir/convos-sdk/`. Migrate config and re-run setup if upgrading.

## 2026-02-16

- README: fix mermaid subgraph id (no leading digit) for pool diagram.
- CLI: rename `start` → `init`, `apply-config` → `apply`; add unified `reset <sessions|chrome>`; document `pnpm cli <cmd>`; README/DESIGN aligned with CLI help; Docker/QA use `pnpm cli apply` and `pnpm cli init`.
- Landing: fix staging/main switch link (staging pointed to dev, now points to main).
- QA: add docs/qa.md with test commands for email, SMS, bankr, search, browser.
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
