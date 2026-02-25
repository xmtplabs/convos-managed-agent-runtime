# fn-1-template-site-implementation.10 Task 9: /og/:slug OG image generation

## Description
TBD

## Acceptance
- [ ] TBD

## Done summary
Added dynamic OG image generation route at /og/[slug] using @vercel/og (Satori) that renders a 1200x630 PNG with Convos branding, agent emoji, name, truncated description, CTA button, QR code, and "No sign up required" text. Updated /a/[slug] template page metadata to reference the OG image with summary_large_image Twitter card for rich social previews.
## Evidence
- Commits: 6767596b78316e7047a066a70dc15669e4f238b9
- Tests: cd dashboard && pnpm build
- PRs: