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
| `index.ts` | Plugin entry — registers HTTP routes for create, join, send, rename, lock, explode |
| `src/channel.ts` | Channel plugin — gateway start/stop, inbound message handling, reply delivery |
| `src/outbound.ts` | Outbound adapter — `sendText` and `sendMedia` via the CLI |
| `src/sdk-client.ts` | `ConvosInstance` — thin wrapper around `convos agent serve` ndjson protocol |
| `src/accounts.ts` | Account resolution from config |
| `src/actions.ts` | Mid-run message actions (profile update, react, attachment) exposed to the agent |
| `src/config-schema.ts` | Zod schema for `channels.convos` config |
| `src/onboarding.ts` | Interactive CLI onboarding (paste invite link) |
| `src/setup.ts` | HTTP setup flow (create conversation, poll join, complete) |
| `src/credentials.ts` | Save/clear identity credentials in config |
| `src/runtime.ts` | Singleton runtime and setup state |

## Target resolution

Since each process has exactly one conversation, target resolution is simple: any non-ID target string (e.g. `"heartbeat"`, `"group"`) is resolved to the bound conversation's ID in `normalizeConvosMessagingTarget`. The outbound adapter always delivers to the bound conversation regardless of the `to` value.

This matters for the **heartbeat system** — the heartbeat agent doesn't know the conversation ID and may pass arbitrary target strings to the message tool. The normalizer ensures they all route correctly.

For agent-authored chat, ordinary text goes through the final reply pipeline. The Convos `send` action is reserved for intercepted `/update-profile ...` commands, so mid-run tool chatter cannot leak into the conversation.

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
| `/convos/setup` | POST | Start interactive setup (returns QR + invite) |
| `/convos/setup/status` | GET | Poll join status during setup |
| `/convos/setup/complete` | POST | Persist config after setup |

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

Identity keys are managed by the CLI in `~/.convos/identities/`. The extension only stores the identity ID reference.

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
```

### 4. Setup flow (Control UI path)

```bash
# Start setup
curl -s -X POST http://localhost:18789/convos/setup \
  -H 'Content-Type: application/json' \
  -d '{"env":"dev","name":"Setup Test","force":true}' | jq .

# Poll until joined
curl -s http://localhost:18789/convos/setup/status | jq .

# Complete (after scanning QR from iOS app)
curl -s -X POST http://localhost:18789/convos/setup/complete | jq .
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
