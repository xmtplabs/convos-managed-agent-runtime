# Changelog

## 2026.2.20 (Unreleased)

### Changes

- Docs: restore modular identity files (AGENTS, SOUL, etc.) in workspace. (#70)
- Convos CLI: update `@xmtp/convos-cli` to ^0.2.0. (#69)
- Docs/Repo: consolidate docs, rename repo references, move CLAUDE.md to workspace rules. (#66)
- Convos CLI: migrate from `@convos/cli` to `@xmtp/convos-cli` (npm). (#64)
- Pool: QR modal redesign to match web-tools landing. (#59)

### Fixes

- Pool: destroy cleanup — remove OpenRouter keys and AgentMail inboxes on instance teardown. (#68)
- Pool: remove MAX_TOTAL cap so pool always maintains idle buffer. (#65)
- Pool: append instance ID to service rename for uniqueness. (#62)
- Gateway/Config: fix restart loop when config-level model changes are applied. (#60)
