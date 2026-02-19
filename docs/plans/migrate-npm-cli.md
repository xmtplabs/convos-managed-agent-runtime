# Migrate `@convos/cli` from git to `@xmtp/convos-cli` (npm)

## Context

`@convos/cli` is currently installed from `github:xmtplabs/convos-cli` as a dependency of the convos extension. This git-hosted approach required three workarounds:

1. **`NODE_ENV=development`** — prepack build needs devDeps (typescript, oclif)
2. **`NODE_PATH`** — extension's nested `node_modules` aren't in Node's default search path
3. **`--no-frozen-lockfile`** — git-hosted deps produce non-deterministic lockfiles

Investigation revealed that the NODE_PATH workaround **doesn't actually work** for resolving `@convos/cli` via standard `require()`. It adds extension roots (not their `node_modules`) to NODE_PATH. Binary resolution only works because `sdk-client.ts` has manual filesystem fallbacks.

Now that `@xmtp/convos-cli` is published on npm (v0.1.0), we can install it at the repo root, which eliminates all three workarounds and fixes the broken NODE_PATH resolution.

## Plan

### Step 1: Add `@xmtp/convos-cli` to root `package.json`

**File:** `package.json`

- Add `"@xmtp/convos-cli": "^0.1.0"` to `dependencies`
- This installs it into `ROOT/node_modules/`, which is already on NODE_PATH via `node-path.sh`
- Run `pnpm install` to update `pnpm-lock.yaml`

### Step 2: Remove `@convos/cli` from extension `package.json`

**File:** `openclaw/extensions/convos/package.json`

- Remove `"@convos/cli": "github:xmtplabs/convos-cli"` from `dependencies`
- Remove the entire `"pnpm": { "onlyBuiltDependencies": ["@convos/cli"] }` block (no build step needed)

### Step 3: Update binary resolution in `sdk-client.ts`

**File:** `openclaw/extensions/convos/src/sdk-client.ts`

- Update `resolveConvosBin()` — change all `@convos/cli` references to `@xmtp/convos-cli`:
  - Line 51: `require.resolve("@convos/cli/package.json")` → `require.resolve("@xmtp/convos-cli/package.json")`
  - Line 66: `node_modules/@convos/cli/bin/run.js` → `node_modules/@xmtp/convos-cli/bin/run.js`
  - Line 79: same path pattern update

### Step 4: Remove `NODE_ENV=development` comment in `install-deps.sh`

**File:** `cli/scripts/install-deps.sh`

- Update the comment on line 8 to remove the convos-cli-specific rationale. The `NODE_ENV=development` flag and `--no-frozen-lockfile` stay (they're applied generically to all extensions) but the comment should no longer cite convos-cli as the reason.

### Step 5: Remove husky workaround from Dockerfile

**File:** `Dockerfile`

- Remove lines 39-41:
  ```
  ENV HUSKY=0
  RUN npm install -g husky
  ```
  These existed solely because the git-hosted convos-cli had a `"prepare": "husky"` script that ran during install. The npm tarball doesn't trigger prepare scripts.
- Change line 2 from `ENV NODE_ENV=development` to `ENV NODE_ENV=production` (convos-cli was the only git-hosted dep requiring development mode). Verify no other deps need it.

### Step 6: Update documentation

**File:** `docs/CLAUDE.md`

- Remove the workaround note: `@convos/cli is not published to npm — ...`
- Replace with: `@xmtp/convos-cli is installed at the repo root (package.json). No special install flags needed.`

**File:** `docs/workarounds.md`

- Update the "Plugin Cannot find module / extension deps resolution" section to note that `@xmtp/convos-cli` is now resolved from `ROOT/node_modules` via NODE_PATH, not from extension-level `node_modules`.
- Remove any references to `github:xmtplabs/convos-cli`.

## Verification

1. `pnpm install` at repo root — confirm `@xmtp/convos-cli` lands in `node_modules/@xmtp/convos-cli/`
2. Verify `node_modules/@xmtp/convos-cli/bin/run.js` exists
3. `node -e "require.resolve('@xmtp/convos-cli/package.json')"` — confirm standard require works from repo root
4. `docker build .` — confirm Docker image builds without husky/NODE_ENV=development
5. Run gateway locally (`pnpm cli gateway`) and confirm convos extension loads without "Cannot find module" errors
