# Convos extension (`openclaw/extensions/convos/`)

OpenClaw channel plugin for **Convos (XMTP)**: E2E encrypted group messaging. One identity per conversation; instance is bound at create/join.

---

## Layout

```
openclaw/extensions/convos/
├── index.ts              # Plugin entry: channel registration, HTTP routes, gateway methods
├── openclaw.plugin.json  # id: convos, channels: [convos]
├── package.json
├── src/
│   ├── channel.ts        # Channel plugin (config, outbound, pairing, inbound wiring)
│   ├── accounts.ts      # resolveConvosAccount, listConvosAccountIds
│   ├── config-schema.ts  # Zod/JSON schema for channels.convos
│   ├── config-types.ts
│   ├── credentials.ts   # identityId, ownerConversationId (~/.convos or state dir)
│   ├── sdk-client.ts    # ConvosInstance: create, join, sendMessage, lock/unlock, explode
│   ├── outbound.ts      # sendText, instance singleton
│   ├── runtime.ts       # getConvosRuntime / setConvosRuntime
│   ├── setup.ts         # setupConvosWithInvite (onboarding flow)
│   ├── onboarding.ts    # convosOnboardingAdapter for Control UI
│   └── actions.ts       # convosMessageActions (react, etc.)
└── skills/
    └── convos-channel.md
```

---

## Config (`channels.convos`)

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | Channel on/off |
| `name` | string | Account display name |
| `identityId` | string | CLI-managed identity (in credentials file takes priority) |
| `ownerConversationId` | string | Conversation ID for operator; set on setup/complete |
| `env` | `"production"` \| `"dev"` | XMTP network |
| `dmPolicy` | `pairing` \| `allowlist` \| `open` \| `disabled` | Who can message in groups |
| `allowFrom` | string[] | Inbox IDs allowed to message (allowlist) |
| `groupPolicy` | `open` \| `disabled` \| `allowlist` | Group handling |
| `groupAllowFrom` | string[] | Optional group sender allowlist |
| `groups` | string[] | Conversation IDs to listen to (when groupPolicy allowlist) |
| `historyLimit` | number | Max group messages as context (0 = no limit) |
| `textChunkLimit` | number | Outbound chunk size (default 4000) |
| `chunkMode` | `length` \| `newline` | Chunking mode |
| `reactionLevel` | `off` \| `ack` \| `minimal` \| `extensive` | Reaction behavior |
| `debug` | boolean | Debug logging |
| `poolApiKey` | string | Optional; Bearer auth for HTTP routes (when set) |

Credentials (`identityId`, `ownerConversationId`) are read from `loadConvosCredentials()` first; config is fallback. Written on setup complete and on `/convos/conversation` / `/convos/join`.

---

## HTTP API (gateway port)

All routes accept optional auth: `Authorization: Bearer <channels.convos.poolApiKey>`. If `poolApiKey` is unset, no auth is required.

### Setup (onboarding)

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/convos/setup` | `{ accountId?, env?, name?, force? }` | `{ inviteUrl, conversationId }` |
| GET | `/convos/setup/status` | — | `{ active, joined, joinerInboxId }` |
| POST | `/convos/setup/complete` | — | `{ saved: true, conversationId }` |
| POST | `/convos/setup/cancel` | — | `{ cancelled: boolean }` |
| POST | `/convos/reset` | `{ accountId?, env? }` | Same as setup (force new identity) |

### Provisioning (pool manager)

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/convos/conversation` | `{ name?, profileName?, profileImage?, description?, imageUrl?, permissions?, instructions?, env?, accountId? }` | `{ conversationId, inviteUrl, inviteSlug }` or 409 if already bound |
| POST | `/convos/join` | `{ inviteUrl, profileName?, profileImage?, instructions?, env?, accountId? }` | `{ status: "joined", conversationId }` or `{ status: "waiting_for_acceptance" }` or 409 if already bound |
| GET | `/convos/status` | — | `{ ready, conversation?: { id }, streaming? }` |

### Conversation control

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/convos/conversation/send` | `{ message }` | `{ messageId }` |
| POST | `/convos/rename` | `{ name }` | `{ ok: true }` |
| POST | `/convos/lock` | `{ unlock?: boolean }` | `{ ok, locked }` |
| POST | `/convos/explode` | — | `{ ok, exploded: true }` |

---

## Gateway methods (WebSocket / Control UI)

| Method | Params | Returns |
|--------|--------|--------|
| `convos.setup` | `{ accountId?, env?, name?, force? }` | `{ inviteUrl, conversationId }` |
| `convos.setup.status` | — | `{ active, joined, joinerInboxId }` |
| `convos.setup.complete` | — | `{ saved: true, conversationId }` |
| `convos.setup.cancel` | — | `{ cancelled }` |
| `convos.reset` | `{ accountId?, env? }` | Same as setup with force |

---

## Channel behavior

- **Capabilities:** `chatTypes: ["group"]`, reactions on, no threads, no media send.
- **Single conversation per process:** `getConvosInstance()` is a singleton; create or join binds the instance until process exit.
- **Outbound:** `convosOutbound.sendText` uses the bound instance; `to` must match `instance.conversationId` or be omitted.
- **Inbound:** Channel wires XMTP stream to OpenClaw session; self-sent message IDs are filtered via `recentSentIds`.

---

## Pool usage

Pool manager calls:

1. **Claim:** pick idle instance (reports `ready: true`, `conversation: null` at `GET /convos/status`).
2. **Provision:** `POST /convos/conversation` with `name`, `instructions`, etc., or `POST /convos/join` with `inviteUrl` and optional `instructions`.
3. Instance writes `INSTRUCTIONS.md` to workspace when `instructions` is provided; starts streaming and is live.

See `docs/design.md` and `pool/README.md` for pool architecture.
