# fn-1-template-site-implementation.8 Task 7: Full parity verification + Pool cleanup

## Description
TBD

## Acceptance
- [ ] TBD

## Done summary
Implemented the full 12-state screenshot parity test suite covering all visual states (idle, empty, joining, success, post-success, error, skill-browser variants, prompt-modal, qr-modal), moved Pool homepage from / to /dashboard with a 302 redirect to the template site at root, and added dashboard scripts to root package.json.
## Evidence
- Commits: 802c037, f153337, 2377e1a
- Tests: cd dashboard && pnpm build, node --test pool/src/**/*.test.js
- PRs: