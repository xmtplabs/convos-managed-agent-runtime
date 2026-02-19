# Migration: Switch Convos Extension to `convos agent serve`

## Why

The current `sdk-client.ts` manages two separate child processes (`conversation stream` + `conversations process-join-requests --watch`), does fragile self-echo filtering via content matching, and has no missed-message catchup when the stream process dies. The `convos agent serve` command already solves most of these problems in a single process with a clean ndjson protocol.

## What `agent serve` already provides

- Single long-lived process: message streaming + join-request processing + stdin commands
- Proper self-echo filtering using `client.inboxId` (not content matching)
- ndjson protocol:
  - **Stdout events:** `ready`, `message`, `member_joined`, `sent`, `error`
  - **Stdin commands:** `send`, `react`, `attach`, `remote-attach`, `stop`
- `ready` event includes `conversationId`, `identityId`, `inboxId`, `inviteUrl`
- Handles pending join requests on startup (batch), then streams new ones
- Graceful shutdown via `stop` command or SIGINT/SIGTERM

## What `agent serve` is missing (CLI changes needed)

These are used by the extension's HTTP routes (`index.ts`) and need to be added as stdin commands:

| Command | Used by | Priority |
|---------|---------|----------|
| `lock` | `POST /convos/lock` | Medium |
| `unlock` | `POST /convos/lock?unlock=true` | Medium |
| `explode` | `POST /convos/explode` | Medium |
| `rename` | `POST /convos/rename`, `startWiredInstance` | High |
| `update-profile` | General | Low (rename covers the main case) |

Additionally, these improvements to `agent serve` would make the extension more robust:

| Improvement | Description |
|-------------|-------------|
| **Missed message catchup** | On stream reconnect, use `conversation messages --sync --sent-after <lastTimestamp>` before restarting the stream. Emit catchup messages as normal `message` events. |
| **Stream health** | Emit a periodic `heartbeat` event (or at minimum an event when the stream reconnects) so the extension knows the process is alive. |
| **`messageId` on sent** | The `sent` event already includes `id` — confirm this is the XMTP message ID usable for echo filtering on the extension side. |

## Status

- **Phase 1 (CLI):** Done — [convos-cli PR #4](https://github.com/xmtplabs/convos-cli/pull/4)
- **Phase 2 (Extension):** Done — see this branch
- **Phase 3 (Cleanup):** Done — all three echo filters removed

## Migration plan

### Phase 1: CLI changes (convos-cli)

Add stdin commands to `agent serve`:

```
{"type":"rename","name":"New Name"}
{"type":"lock"}
{"type":"unlock"}
{"type":"explode"}
```

Each emits a corresponding stdout event on success:
```
{"event":"renamed","name":"New Name","timestamp":"..."}
{"event":"locked","timestamp":"..."}
{"event":"unlocked","timestamp":"..."}
{"event":"exploded","timestamp":"..."}
```

Add missed-message catchup: track `lastMessageTimestamp` in the message stream handler. On stream reconnect, fetch messages since that timestamp via `conversation.messages({ sentAfterNs, direction: ascending, sync: true })` and emit them as normal `message` events before resuming the stream.

### Phase 2: Extension rewrite (convos-agents)

**Replace `sdk-client.ts`** with a thin wrapper that:
1. Spawns `convos agent serve <conversationId>` (or `convos agent serve --name "..." ` for new conversations)
2. Reads stdout line by line, parses ndjson events, dispatches to callbacks
3. Writes stdin commands as ndjson for send/react/lock/unlock/explode/rename
4. Tracks process health — if it dies, restarts with exponential backoff (with counter reset after sustained uptime)

**Simplify `outbound.ts`**:
- `sendText` writes `{"type":"send","text":"..."}` to stdin
- Track sent message IDs from `sent` events (for the outbound adapter's return value)
- Remove `recentSentIds` — self-echo filtering is handled by `agent serve`

**Simplify `channel.ts`**:
- `gateway.startAccount`: spawn `agent serve`, wire `message` events to `handleInboundMessage`
- `gateway.stopAccount`: send `{"type":"stop"}` to stdin, wait for exit, then SIGTERM if needed
- Remove `startWiredInstance` complexity — it becomes "spawn agent serve + wait for ready event"
- Remove the `ConvosInstance` import — all operations go through the stdin/stdout protocol

**Simplify `actions.ts`**:
- `send` → write to stdin
- `react` → write to stdin

**Simplify `index.ts` HTTP routes**:
- `/convos/conversation/send` → write to stdin
- `/convos/rename` → write to stdin
- `/convos/lock` → write to stdin
- `/convos/explode` → write to stdin, then clean up
- `/convos/conversation` (create) → spawn `agent serve` without a conversation ID (it creates one), read `ready` event for the invite URL
- `/convos/join` → still needs to be a separate `convos conversations join` call before starting `agent serve`, since joining is a one-time operation that may require approval

### Phase 3: Cleanup

- Delete most of `sdk-client.ts` (or replace entirely with a ~100 line agent-serve wrapper)
- Remove the three-layer self-echo filtering (content matching in sdk-client, recentSentIds in outbound, senderId check in channel)
- Remove `recentSentContent` tracking

## Files affected

| File | Change |
|------|--------|
| `src/sdk-client.ts` | Replace with agent-serve ndjson wrapper |
| `src/outbound.ts` | Simplify to stdin writes, remove echo tracking |
| `src/channel.ts` | Simplify gateway start/stop, remove manual child management |
| `src/actions.ts` | Route through stdin wrapper |
| `index.ts` | HTTP routes delegate to wrapper instead of ConvosInstance |

## Open questions

- Should `/convos/join` use `agent serve` with a new `--join <invite>` flag? Or keep it as a separate `conversations join` + `agent serve` two-step?
- Should the `ready` event include the `inboxId` so we can pass it to `resolveConvosAccount`? (It already does.)
- Do we need `agent serve` to support attaching to a conversation that was joined but not created by this identity? (It already does — you pass the conversation ID as an arg.)
