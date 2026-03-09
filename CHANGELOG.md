# Changelog

## 0.0.22

- Proxy service API calls (email, SMS) through pool manager (#396)
  - Instances no longer receive `AGENTMAIL_API_KEY`, `TELNYX_API_KEY`, or `TELNYX_MESSAGING_PROFILE_ID`
  - New `/api/proxy/*` endpoints on pool manager with per-instance auth (`instanceId:gatewayToken`)
  - Email/SMS proxy enforces per-instance inbox and phone number from DB
  - Runtime handlers auto-detect proxy mode (`POOL_URL` + `INSTANCE_ID` + `GATEWAY_TOKEN`), fall back to direct API keys for local dev
  - Bankr key (`BANKR_API_KEY`) still passed through directly to instances
- Simplify pool env config: derive `POOL_URL` from `RAILWAY_PUBLIC_DOMAIN`, remove manual `POOL_ENVIRONMENT`
- Unify instance auth to single `OPENCLAW_GATEWAY_TOKEN` (#395)
  - Remove `POOL_API_KEY`, `SETUP_PASSWORD`, `PRIVATE_WALLET_KEY` from instances
  - Legacy fallback in `authFetch.ts` for old instances

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
