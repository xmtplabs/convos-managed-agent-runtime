

# IMPORTANT

- dont tour core convos extension
- always use pnpm
- PRIVATE_WALLET_KEY does nothing to do with Convos!
- dont rush into action. ask
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
- To promote between tiers: cherry-pick the specific commits, do NOT merge the entire branch
- Never PR directly to `main` or `staging` unless explicitly asked

# Railway Migration Steps (Manual)

When deploying pool manager changes to a new Railway environment:

1. Hit **Drain Unclaimed** in the pool dashboard — removes all idle/starting instances
2. Set pool manager root directory to `/pool`
3. Remove all `INSTANCE_*` env vars — instance keys now use their original names (`OPENCLAW_PRIMARY_MODEL`, `AGENTMAIL_API_KEY`, etc.)
4. Runtime image defaults to `ghcr.io/xmtplabs/convos-runtime:latest`. Set `RAILWAY_RUNTIME_IMAGE` to override.
5. Replenish manually via the admin dashboard "+ Add" button
