

# IMPORTANT

- dont tour core convos extension
- always use pnpm
- dont rush into action. ask
- never update dependencies. everything breaks when bumped.
- When in doubt, don't automate, better to think of good and manual flows and tools.
- **NEVER add automatic cleanup/destroy logic to the tick loop.** The tick must never auto-delete Railway projects, services, or volumes. Dead/crashed instances get marked in the DB and must be cleaned up manually via the dashboard. Only explicit user actions (kill, drain, dismiss) may destroy infrastructure.

# Security Rules

- **Every new Express router must be mounted with `requireAuth` middleware** unless it is explicitly public. No exceptions.
- **Never use `SELECT *` in queries that reach the browser.** Always use explicit column lists and exclude secrets (`gateway_token`, `env_value`, API keys, tokens).
- **Never embed secrets (API keys, tokens) in HTML/JS.** Use httpOnly session cookies for browser auth. The admin page must never contain `POOL_API_KEY` or any secret in its source.
- **Never pass secrets as URL query params** (`?key=`). They leak in logs, referer headers, and browser history.

# Branch Strategy

Changes flow through branches in this order:

```
feature-branch → dev → staging → main
```

- **dev**: development; Railway dev environment
- **staging**: promoted from dev for pre-production testing
- **main**: production

## Rules

- Feature PRs target `dev`
- **CRITICAL: Always create feature branches from the TARGET branch (e.g. `git checkout origin/dev && git checkout -b my-branch`). NEVER branch off another feature branch or you will drag unrelated commit history into the PR.**
- Never PR directly to `main` or `staging` unless explicitly asked
- **Never add test plans to PRs.** No `## Test plan` section — keep PR descriptions to Summary and Why only.

# Branch strategy

Never use `gh pr create --head dev --base staging` directly — it skips conflict resolution and leaves merge conflicts in the PR.

Always merge locally first:

1. `git checkout -b merge/dev-to-staging origin/staging`
2. `git merge origin/dev` — resolve any conflicts
3. Push the merge branch and PR from `merge/dev-to-staging` → `staging`

# Runtime: Shared Workspace

Skills, SOUL.md, and AGENTS-base.md live in `runtime/shared/workspace/`. Both runtimes copy from there at boot.

- **Default to shared.** New skills go in `runtime/shared/workspace/skills/`. New agent instructions go in `AGENTS-base.md`. Only put something in a runtime's own workspace if it genuinely doesn't apply to the other.
- **AGENTS.md is assembled**, not edited directly. `AGENTS-base.md` + runtime's `agents-extra.md` → `AGENTS.md`. Never check in a standalone AGENTS.md for either runtime.
- **Use `$SKILLS_ROOT`** in SKILL.md paths, not `$OPENCLAW_STATE_DIR` or `$HERMES_HOME`.
- **Add deps to both** `hermes/package.json` and `openclaw/package.json` when a shared skill needs a Node CLI.

# Railway Migration Steps (Manual)

When deploying pool manager changes to a new Railway environment:

1. Hit **Drain Unclaimed** in the pool dashboard — removes all idle/starting instances
2. Set pool manager root directory to `/pool`
3. Remove all `INSTANCE_*` env vars — instance keys now use their original names (`OPENCLAW_PRIMARY_MODEL`, `AGENTMAIL_API_KEY`, etc.)
4. Runtime image is tagged by branch (e.g. `:dev`, `:production`). Set `RAILWAY_RUNTIME_IMAGE` to override.
5. Replenish manually via the admin dashboard "+ Add" button

# Evals

- Optimize rubriks for FAIL if... if not ... then pass.
- Suggest running evals with a running agent in another terminal to see the log trace.