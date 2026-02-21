# Convos-agent workarounds

Documented workarounds so future changes don't break them or duplicate logic.

---

## Dependencies

All deps live in root `package.json`. No global installs, no state-dir package.json.

**How they resolve at runtime:**

| Dep type | Examples | Resolved via | Setup |
|---|---|---|---|
| Extension deps | (each extension's own deps) | `pnpm install` in each `STATE_DIR/extensions/*` | `pnpm cli install-deps` |
| Repo-level / CJS | `openclaw`, `@xmtp/convos-cli` | `NODE_PATH` → `ROOT/node_modules` | `node-path.sh` (sourced by gateway/qa) |
| Skill CLIs | `@telnyx/api-cli`, `@bankr/cli` | `PATH` → `ROOT/node_modules/.bin` | `node-path.sh` |
| Skill JS libraries (ESM) | `agentmail` | Symlink into `STATE_DIR/node_modules` | `install-deps.sh` (`SKILL_LIBS` list) |

**Why the symlink?** ESM `import` does NOT respect `NODE_PATH` — it only walks up from the importing file. Skill scripts run from `~/.openclaw/workspace/skills/...` (state dir), which is a different tree from `ROOT/node_modules`. The symlink bridges the gap.

**To add a new dep:**
1. `pnpm add <package>` (adds to root `package.json`)
2. If it's a JS library used by ESM skill scripts, add the package name to `SKILL_LIBS` in `install-deps.sh`
3. Done. CLIs and CJS deps need no extra step.

## OpenClaw config

### Memory slot: use "none"

Default config sets `plugins.slots.memory` to `memory-core`. If that extension isn't shipped, config validation fails. Set it to `"none"` in [openclaw/openclaw.json](openclaw/openclaw.json).

### Extension id must match package/manifest

Package.json `name`, openclaw.plugin.json `id`, and channel id must all match. We use `"convos"` everywhere.

### Registered vs script-based skills

- **Registered skills** have `_meta.json` → can be referenced in `alsoAllow`/`deny`
- **Script-based skills** (e.g. `agentmail`) use `exec` only → do NOT put in `alsoAllow`/`deny` (triggers "unknown entries" warnings)

### openclaw dependency in extension

Extension uses `"openclaw": "workspace:*"` for types/sdk. In Docker, sed replaces it with `"openclaw": "file:/openclaw"`.

## Skill script paths

Skills live under `$OPENCLAW_STATE_DIR/workspace/skills/`. Invoke them with the full state dir path:
```
node $OPENCLAW_STATE_DIR/workspace/skills/agentmail/scripts/<script>.mjs
```

## Browser

See [docs/browser.md](browser.md) for the full browser reference (config, startup self-heal, troubleshooting, Railway/Docker).

## Control UI: replies only after refresh

Known limitation in OpenClaw core. Gateway completes the run but the webchat client doesn't always receive it over WebSocket. Refresh to see replies. Fix requires changes in the main OpenClaw repo.
