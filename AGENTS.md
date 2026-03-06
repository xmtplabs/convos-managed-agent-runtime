# Convos Agents — Agent Guide

## Structure
Three subprojects: **pool/** (Express API + Drizzle/Postgres pool manager), **runtime/** (Docker agent image with OpenClaw + XMTP), **dashboard/** (Next.js + Tailwind at assistants.convos.org). Use `pnpm` everywhere — never npm/yarn. Never update dependencies.

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
- Don't touch the convos extension (`runtime/openclaw/extensions/convos/`). Ask before acting.
