# CLAUDE.md

Pre-warmed AI assistant containers on XMTP/Convos — Express pool manager, OpenClaw + Hermes runtimes, Railway compute. Uses pnpm.

## Project map

- `pool/` — Pool manager: Express API + Postgres (instance lifecycle, providers, admin dashboard)
- `runtime/harness/openclaw/` — OpenClaw harness (Node.js, primary runtime)
- `runtime/harness/hermes/` — Hermes harness (Python FastAPI)
- `runtime/convos-platform/` — Shared platform files: SOUL.md, AGENTS.md template, skills, per-runtime sections (seeded into each runtime at boot)
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

Agent instructions follow a 3-layer architecture. Each layer has a clear boundary — don't duplicate content across layers:

| Layer | File(s) | Contains | Does NOT contain |
|---|---|---|---|
| 1. Personality | `SOUL.md` | Who you are, philosophy, group behavior | Platform mechanics, tool names |
| 2. Agent Instructions | `convos-platform/AGENTS.md` (template) + per-runtime section files in `convos-platform/<runtime>/` | Shared behavioral rules + `<!-- SECTION:xxx -->` markers. Section files contain runtime-specific wiring (tool names, config paths, platform markers) | Skills |
| 3. Skills | `convos-platform/skills/` | Complex behavioral guidance loaded on demand | Platform mechanics (defers to layer 2) |

AGENTS.md templating:
- `convos-platform/AGENTS.md` is the template with shared prose and `<!-- SECTION:name -->` markers.
- Each runtime has section files in `convos-platform/<runtime>/` (e.g. `convos-platform/openclaw/DELEGATION.md`) that replace the markers at boot.
- Missing section files cause the marker line to be silently removed.
- Section files map to eval suites (e.g. `DELEGATION.md` → `delegation.yaml`).

Rules:
- Default to shared: new skills go in `runtime/convos-platform/skills/`, new shared instructions go in `convos-platform/AGENTS.md`.
- Runtime-specific wiring goes in a section file in `convos-platform/<runtime>/` and a matching `<!-- SECTION:name -->` marker in the template.
- Never check in a standalone AGENTS.md in the runtime directories — it's assembled at boot.
- Use `$SKILLS_ROOT` in SKILL.md paths, not `$OPENCLAW_STATE_DIR` or `$HERMES_HOME`.
- Add deps to both `harness/hermes/package.json` and `harness/openclaw/package.json` when a shared skill needs a Node CLI.

</important>

<important if="you are deploying pool manager changes to a new Railway environment">

Manual migration steps:

1. Hit **Drain Unclaimed** in pool dashboard — removes all idle/starting instances
2. Set pool manager root directory to `/pool`
3. Remove all `INSTANCE_*` env vars — instance keys now use their original names
4. Runtime image is tagged by branch (`:dev`, `:production`). Set `RAILWAY_RUNTIME_IMAGE` to override.
5. Replenish manually via the admin dashboard "+ Add" button

</important>

<important if="you are modifying runtime boot scripts (runtime/harness/openclaw/scripts/ or runtime/harness/hermes/scripts/)">

**Do not rename, reorder, or remove boot scripts.** Both runtimes follow the same fixed pipeline: `init.sh` → `apply-config.sh` → `install-deps.sh` → `identity.sh` → `start.sh`. The names and execution order are load-bearing — Dockerfiles, entrypoints, CI workflows, and `pnpm start` all depend on them. Edit script internals when needed, but never change the script names or the sequence.

</important>

<important if="you are writing or modifying evals, rubrics, or eval configs">

- Optimize rubrics for FAIL-first: "FAIL if X, otherwise PASS".
- Suggest running evals with a running agent in another terminal to see the log trace.

</important>
