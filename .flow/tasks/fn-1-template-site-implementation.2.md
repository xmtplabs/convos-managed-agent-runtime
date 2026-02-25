# fn-1-template-site-implementation.2 Task 1: Extract CSS + API client + Pool endpoints

## Description
TBD

## Acceptance
- [ ] TBD

## Done summary
Extracted ~700 lines of user-facing CSS from pool/src/index.js into dashboard/src/app/pool.css verbatim, created TypeScript types and server-side API client, added /api/pool/templates endpoints with CORS to Pool, and created Next.js API proxy routes for claim and prompts.
## Evidence
- Commits: 080034c, 89d852b, 798cd70
- Tests: pnpm build, npx playwright test
- PRs: