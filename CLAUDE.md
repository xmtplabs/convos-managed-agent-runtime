

# IMPORTANT

- dont tour core convos extension
- always use pnpm
- PRIVATE_WALLET_KEY does nothing to do with Convos!

# Branch Strategy

Changes flow through branches in this order:

```
feature-branch → scaling → dev → staging → main
```

- **scaling**: experimental/scaling/pool work lands here first
- **dev**: promoted from scaling when ready; Railway dev environment
- **staging**: promoted from dev for pre-production testing
- **main**: production

## Rules

- Feature PRs target `scaling` (for scaling/pool work) or `dev` (for general fixes)
- **CRITICAL: Always create feature branches from the TARGET branch (e.g. `git checkout origin/scaling && git checkout -b my-branch`). NEVER branch off another feature branch or you will drag unrelated commit history into the PR.**
- To promote between tiers: cherry-pick the specific commits, do NOT merge the entire branch
- Never PR directly to `main` or `staging` unless explicitly asked

# Railway Migration Steps (Manual)

When deploying pool manager changes to a new Railway environment:

1. Set `POOL_MIN_IDLE=0` — prevents tick loop from spinning up instances during migration
2. Hit **Drain Unclaimed** in the pool dashboard — removes all idle/starting instances
3. Set pool manager root directory to `/pool`
4. Remove all `INSTANCE_*` env vars — instance keys now use their original names (`OPENCLAW_PRIMARY_MODEL`, `AGENTMAIL_API_KEY`, etc.)
5. Runtime image defaults to `ghcr.io/xmtplabs/convos-runtime:latest`. Set `RAILWAY_RUNTIME_IMAGE` to override.
6. Once stable, set `POOL_MIN_IDLE` back to desired count (e.g. `3`)

**Important**: Drain without `POOL_MIN_IDLE=0` is useless — the next tick (~30s) will just recreate the instances.
