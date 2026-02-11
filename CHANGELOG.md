# Changelog

## Unreleased

- Versioning: add `version` (1.0.0) and `engines.node` (>=22) to root package.json; keep workspace/.version (6) for agent Brain seed only; Docker writes OpenClaw ref+commit to /openclaw/openclaw-version.json; entrypoint logs agent and OpenClaw versions at startup.

## 2026-02-11

- Landing: show "SPIN UP AGENT" button first; QR code appears only after click instead of auto-fetch on load

- d007be9 Enable convos plugin and pin pnpm version
- 9e15c17 convos extension updates, exa-search & smooth-browser skills, config and scripts
- 1c1cd4a feat(convos): rename env config key to XMTP_ENV, default to dev

## 2026-02-10

- e822607 workspace: personal group-chat hint + smooth web automation rule
- 3540508 chore: update Dockerfile, package, entrypoint, workspace docs and cursor rules
- ee36b3d config: apply .env to openclaw.json via standalone script, detach from startup
- 3d01eb8 Skills config via openclaw.json, remove bankr from convos
- 82f974d Add Taskfile.yml and optimize scripts

## 2026-02-09

- d95ce7f first commit
