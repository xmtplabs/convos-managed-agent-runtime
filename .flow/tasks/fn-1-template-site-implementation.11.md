# fn-1-template-site-implementation.11 Task 10: /qr/:slug QR code generation

## Description
TBD

## Acceptance
- [ ] TBD

## Done summary
Added /qr/:slug route that generates 400px PNG QR codes encoding template page URLs using the qrcode library, with 24h cache headers. Updated OG image route and template-actions to use self-hosted QR endpoint instead of external api.qrserver.com. Added shared getSiteUrl() utility that derives the public origin from request headers for correct behavior across all deployment environments.
## Evidence
- Commits: ff9347d, fd7582d, 0e32668
- Tests: pnpm build (dashboard)
- PRs: