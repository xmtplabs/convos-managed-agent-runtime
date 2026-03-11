# @openclaw/convos

OpenClaw channel plugin for [Convos](https://convos.app) — E2E encrypted group messaging via XMTP.

## How it works

Each process is bound to **one conversation**. The extension shells out to the `convos` CLI binary (`convos agent serve`) which manages a long-lived XMTP stream, join-request processing, and message delivery over an ndjson stdin/stdout protocol.

```
openclaw gateway
  └─ convos agent serve <conversationId>
       ├─ stdout → ndjson events (message, member_joined, sent, heartbeat, ...)
       └─ stdin  ← ndjson commands (send, react, rename, lock, ...)
```

## Source files

| File | Purpose |
|------|---------|
| `index.ts` | Plugin entry — registers HTTP routes for create, join, send, rename, lock, explode, reset |
| `src/channel.ts` | Channel plugin — gateway start/stop, inbound message handling, reply delivery |
| `src/outbound.ts` | Outbound adapter — `sendText` and `sendMedia` via the CLI |
| `src/sdk-client.ts` | `ConvosInstance` — thin wrapper around `convos agent serve` ndjson protocol |
| `src/accounts.ts` | Account resolution from config |
| `src/actions.ts` | Message actions (send, react) exposed to the agent |
| `src/config-schema.ts` | Zod schema for `channels.convos` config |
| `src/onboarding.ts` | Interactive CLI onboarding (paste invite link) |
| `src/credentials.ts` | Save/clear identity credentials in config |
| `src/runtime.ts` | Singleton runtime reference |

## Target resolution

Since each process has exactly one conversation, target resolution is simple: any non-ID target string (e.g. `"heartbeat"`, `"group"`) is resolved to the bound conversation's ID in `normalizeConvosMessagingTarget`. The outbound adapter always delivers to the bound conversation regardless of the `to` value.

This matters for the **heartbeat system** — the heartbeat agent doesn't know the conversation ID and may pass arbitrary target strings to the message tool. The normalizer ensures they all route correctly.

## HTTP routes

All routes are registered on the gateway server (default `http://127.0.0.1:18789`).

| Route | Method | Description |
|-------|--------|-------------|
| `/convos/conversation` | POST | Create a new conversation, returns invite URL |
| `/convos/join` | POST | Join via invite URL |
| `/convos/conversation/send` | POST | Send a message |
| `/convos/rename` | POST | Rename the conversation |
| `/convos/lock` | POST | Lock/unlock the conversation |
| `/convos/explode` | POST | Permanently destroy the conversation |
| `/convos/status` | GET | Report the active conversation plus residue flags that determine whether the runtime is reusable |
| `/convos/reset` | POST | Factory-reset local Convos state and return the post-reset status |

## Config

```json
{
  "channels": {
    "convos": {
      "enabled": true,
      "identityId": "<cli-managed-id>",
      "env": "production",
      "ownerConversationId": "<conversation-id>",
      "dmPolicy": "pairing"
    }
  }
}
```

Identity keys are managed by the CLI in `~/.convos/identities/`. The extension only stores the identity ID reference, and `/convos/reset` clears both the stored binding and the local CLI identity/db so the next create/join starts fresh.

## Testing

Requires the Convos iOS app on a real device and a running gateway.

### Clean start

```bash
# Clear existing config (if re-testing from scratch)
pnpm openclaw config set channels.convos.ownerConversationId ""
pnpm openclaw config set channels.convos.identityId ""
pnpm openclaw config set channels.convos.enabled false

# Optional: wipe CLI identity + XMTP database
rm -rf ~/.convos/identities ~/.convos/db
```

### 1. Onboarding

```bash
pnpm openclaw configure
```

Select Convos, paste an invite link from the iOS app. Verify config shows `identityId`, `ownerConversationId`, `enabled: true`.

### 2. Message round-trip

```bash
pnpm openclaw gateway run --port 18789
pnpm openclaw channels status --probe  # should show running: true
```

Send a message from the iOS app — verify the agent replies.

### 3. HTTP routes

```bash
# Create conversation
curl -s -X POST http://localhost:18789/convos/conversation \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test"}' | jq .

# Send message
curl -s -X POST http://localhost:18789/convos/conversation/send \
  -H 'Content-Type: application/json' \
  -d '{"message":"Hello from HTTP"}' | jq .

# Rename
curl -s -X POST http://localhost:18789/convos/rename \
  -H 'Content-Type: application/json' \
  -d '{"name":"Renamed"}' | jq .

# Lock / unlock
curl -s -X POST http://localhost:18789/convos/lock -H 'Content-Type: application/json' -d '{}' | jq .
curl -s -X POST http://localhost:18789/convos/lock -H 'Content-Type: application/json' -d '{"unlock":true}' | jq .
# Status
curl -s http://localhost:18789/convos/status | jq .

# Example fields:
# {
#   "ready": true,
#   "conversation": null,
#   "main": { "active": false, "conversationId": null, "streaming": false },
#   "persisted": {
#     "credentialsPresent": false,
#     "configBindingPresent": false,
#     "customInstructionsPresent": false,
#     "cliIdentityPresent": false,
#     "cliDbPresent": false,
#     "conversationEnvPresent": false
#   },
#   "dirtyReasons": [],
#   "clean": true,
#   "reusable": true
# }

# Reset local state and wipe the current identity
curl -s -X POST http://localhost:18789/convos/reset \
  -H 'Content-Type: application/json' \
  -d '{}' | jq .
```

### Expected failures

| Scenario | Expected |
|----------|----------|
| Binary not found | Error on gateway start |
| Invalid invite | Onboarding shows error |
| Double create | `409` on second call |
| Send with no instance | `400 "No active conversation"` |
| Network down | Stream exits, gateway logs exit code |

See [SMOKE-TEST.md](./SMOKE-TEST.md) for the full manual checklist.
