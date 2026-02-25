# fn-1-template-site-implementation.1 Task 0: Scaffold Next.js + Playwright screenshot tests

## Description
TBD

## Acceptance
- [ ] TBD

## Done summary
Scaffolded Next.js 15 app (dashboard/) with Playwright screenshot testing infrastructure and mock Pool server. The app fetches pool counts and renders idle/empty states, with 4 passing parity tests across desktop and mobile viewports using platform-independent baselines.
## Evidence
- Commits: 045c6d9, 33169e6, aeefe4e, 40be5ee, 0eb9c9e
- Tests: pnpm build, npx playwright test (4/4 passed: idle+empty x desktop+mobile)
- PRs: