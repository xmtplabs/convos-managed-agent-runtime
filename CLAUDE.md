# CLAUDE.md

Pre-warmed AI assistant containers on XMTP/Convos — Express pool manager, OpenClaw + Hermes runtimes, Railway compute. Uses pnpm.

## Project map

- `pool/` — Pool manager: Express API + Postgres (instance lifecycle, providers, admin dashboard)
- `runtime/openclaw/` — OpenClaw harness (Node.js, primary runtime)
- `runtime/hermes/` — Hermes harness (Python FastAPI, experimental)
- `runtime/shared/workspace/` — Shared skills, SOUL.md, AGENTS-base.md (both runtimes copy at boot)
- `workers/credits-sweep/` — Cloudflare Worker: cron-based OpenRouter credit spend tracking → PostHog
- `dashboard/` — Playroom: Next.js app at assistants.convos.org

## Approach

- Don't rush into action — ask first.
- Never update dependencies. Everything breaks when bumped.
- Don't tour the core Convos extension.
- When in doubt, prefer manual flows and tools over automation.

<important if="you need to run commands to build, test, or manage the database">

All commands use `pnpm`.

**Pool** (run from `pool/`):

| Command | What it does |
|---|---|
| `pnpm build` | Build (tsc) |
| `pnpm dev` | Start dev server |
| `pnpm test` | Run tests |
| `pnpm db:migrate` | Run Drizzle migrations |
| `pnpm db:generate` | Generate Drizzle client |
| `pnpm db:push` | Push schema to database |
| `pnpm db:studio` | Open Drizzle Studio |
| `pnpm stripe:listen` | Forward Stripe webhooks locally |

**Runtime** (run from `runtime/`):

| Command | What it does |
|---|---|
| `pnpm start` | Start OpenClaw runtime |
| `pnpm start:hermes` | Start Hermes runtime |
| `pnpm evals` | Run all OpenClaw evals |
| `pnpm evals:hermes` | Run all Hermes evals |

</important>

<important if="you are modifying instance lifecycle, pool management, or infrastructure teardown">

**NEVER add automatic cleanup/destroy logic.** Dead/crashed instances get marked in the DB and must be cleaned up manually via the dashboard. Only explicit user actions (kill, drain, dismiss) may destroy Railway projects, services, or volumes.

</important>

<important if="you are adding Express routes, API endpoints, or query code that returns data to the browser">

- Every new Express router must be mounted with `requireAuth` middleware unless explicitly public.
- Never use `SELECT *` in queries that reach the browser — use explicit column lists, exclude secrets (`gateway_token`, `env_value`, API keys, tokens).
- Never embed secrets in HTML/JS. Use httpOnly session cookies for browser auth.
- Never pass secrets as URL query params — they leak in logs, referer headers, and browser history.

</important>

<important if="you are creating branches, making commits, opening PRs, or promoting between branches">

Branch flow: `feature-branch → dev → staging → main`

- Feature PRs target `dev`.
- **Always create feature branches from the TARGET branch** (e.g. `git checkout origin/dev && git checkout -b my-branch`). Never branch off another feature branch.
- Never PR directly to `main` or `staging` unless explicitly asked.
- No `## Test plan` in PRs — keep descriptions to Summary and Why only.

**Promoting (dev → staging → main):** Always merge locally first — never use `gh pr create --head dev --base staging` directly.

1. `git checkout -b merge/dev-to-staging origin/staging`
2. `git merge origin/dev` — resolve conflicts
3. Push the merge branch and PR from it → `staging`

</important>

<important if="you are adding or modifying skills, AGENTS.md, SOUL.md, or runtime workspace files">

Agent instructions follow a 5-layer architecture. Each layer has a clear boundary — don't duplicate content across layers:

| Layer | File(s) | Contains | Does NOT contain |
|---|---|---|---|
| 1. Personality | `SOUL.md` | Who you are, philosophy, group behavior | Platform mechanics, tool names |
| 2. Behavioral Rules | `AGENTS-base.md` | Communication limits, boundaries, privacy, capability awareness, proactivity, loop guard, silence concept, emotional intelligence | SILENT marker syntax, message format, platform-specific details |
| 3. Runtime Rules | `agents-extra.md` | Delegation tool names, memory mechanisms | Shared rules or platform mechanics |
| 4. Platform Context | `CONVOS_PLATFORM.md` (both runtimes) | Tool names, SILENT/PROFILE markers, CLI commands, message format, don't narrate | Behavioral reasoning (when to be silent, 3-sentence limit) |
| 5. Skills | `skills/profile-update/`, `skills/services/`, `skills/convos-runtime/` | Complex behavioral guidance loaded on demand | Platform mechanics (defers to layer 4) |

Rules:
- Default to shared: new skills go in `runtime/shared/workspace/skills/`, new agent instructions go in `AGENTS-base.md`.
- AGENTS.md is assembled (`AGENTS-base.md` + runtime's `agents-extra.md`). Never check in a standalone AGENTS.md.
- Platform mechanics (tool syntax, markers, CLI commands) go in `CONVOS_PLATFORM.md`, not `AGENTS-base.md`.
- Use `$SKILLS_ROOT` in SKILL.md paths, not `$OPENCLAW_STATE_DIR` or `$HERMES_HOME`.
- Add deps to both `hermes/package.json` and `openclaw/package.json` when a shared skill needs a Node CLI.

</important>

<important if="you are deploying pool manager changes to a new Railway environment">

Manual migration steps:

1. Hit **Drain Unclaimed** in pool dashboard — removes all idle/starting instances
2. Set pool manager root directory to `/pool`
3. Remove all `INSTANCE_*` env vars — instance keys now use their original names
4. Runtime image is tagged by branch (`:dev`, `:production`). Set `RAILWAY_RUNTIME_IMAGE` to override.
5. Replenish manually via the admin dashboard "+ Add" button

</important>

<important if="you are modifying runtime boot scripts (runtime/openclaw/scripts/ or runtime/hermes/scripts/)">

**Do not rename, reorder, or remove boot scripts.** Both runtimes follow the same fixed pipeline: `init.sh` → `apply-config.sh` → `install-deps.sh` → `identity.sh` → `start.sh`. The names and execution order are load-bearing — Dockerfiles, entrypoints, CI workflows, and `pnpm start` all depend on them. Edit script internals when needed, but never change the script names or the sequence.

</important>

<important if="you are writing or modifying evals, rubrics, or eval configs">

- Optimize rubrics for FAIL-first: "FAIL if X, otherwise PASS".
- Suggest running evals with a running agent in another terminal to see the log trace.

</important>
