# Changelog

## 0.0.21

- Bump `@xmtp/convos-cli` from v0.3.2 to v0.4.0
  - Message-based profiles (ProfileUpdate/ProfileSnapshot) replace appData writes
  - Agents automatically self-identify as `memberKind: Agent`
  - Structured JoinRequest content type with backward-compat plain text fallback
  - New `--fields` flag and `convos schema` introspection command
- Update `ConvosInstance.join()` for renamed JSON field (`name` → `conversationName`)
- **Note:** Do not promote to staging/main until iOS ships ProfileUpdate support (#552, #382)

## 0.0.20

- Atomic `environmentPatchCommit` to eliminate env var race (#371)
- Bump runtime to 0.0.20 (#374)
- Move morning check-in from heartbeat to cron job (#367)
