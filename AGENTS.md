# Convos Agents — Agent Guide

## Structure
**pool/** (Express API + Drizzle/Postgres pool manager), **runtime/** (two agent runtimes + shared workspace + evals), **dashboard/** (Next.js + Tailwind at assistants.convos.org). Use `pnpm` everywhere — never npm/yarn. Never update dependencies.

## Runtime: Convos Platform
Skills, SOUL.md, and the AGENTS.md template live in `runtime/convos-platform/`. Both runtimes (OpenClaw and Hermes) are seeded from there at boot. The `AGENTS.md` template contains `<!-- SECTION:name -->` markers that get replaced with runtime-specific section files from `convos-platform/<runtime>/` (e.g. `convos-platform/openclaw/DELEGATION.md`). Missing sections are silently removed. Section files map to eval suites. Default to shared — only create section files for runtime-specific wiring. Use `$SKILLS_ROOT` in SKILL.md paths. Add deps to both `hermes/package.json` and `openclaw/package.json` when a shared skill needs a Node CLI.

## Commands
- Pool: `cd pool && pnpm dev` / `pnpm build` (tsc) / `pnpm test` / `pnpm db:migrate` / `pnpm db:studio`
- Single test: `cd pool && pnpm tsx --env-file=.env --test src/path/to/file.test.ts`
- Dashboard: `cd dashboard && pnpm dev` / `pnpm build` / `pnpm test:parity` (Playwright)
- Runtime: `cd runtime && pnpm build` (Docker) / `pnpm build:run`

## Code Style (pool/ — TypeScript)
- ESM (`"type": "module"`), Node ≥22, strict TypeScript. Imports: node builtins with `node:` prefix, named exports, barrel files for db/services.
- Express 5 routes with `requireAuth` middleware on every new router (security rule). Drizzle ORM for DB — explicit column selects, never `SELECT *` to browser. Never embed secrets in HTML/JS or pass as query params.

## Branch Strategy
`feature-branch → dev → staging → main`. PRs target `dev`. Branch from target: `git checkout origin/dev && git checkout -b my-branch`. No test plans in PR descriptions.

## Critical Rules
- **Never auto-cleanup/destroy on a schedule** — dead instances are marked in DB, cleaned manually via dashboard.
- Don't touch the convos extension (`runtime/harness/openclaw/extensions/convos/`). Ask before acting.
