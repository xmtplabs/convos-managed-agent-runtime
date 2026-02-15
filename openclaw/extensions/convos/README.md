# Convos extension

E2E encrypted messaging via XMTP. OpenClaw talks to one Convos conversation per process using the `convos` CLI.

## Architecture

- **CLI-only**: All XMTP operations shell out to the `convos` binary (`convos <command> --json`). No in-process XMTP client.
- **One process = one conversation**: The gateway binds to a single conversation. Create/join is done at setup (or via pool HTTP routes); the agent only sends and reacts in that conversation.
- **Identity**: Managed by the CLI under `~/.convos/identities/`. The extension uses `identityId` from config.
- **Streaming**: Long-lived child processes for message stream and join-request handling; one-shot CLI calls for send, react, lock, explode.

### Convos CLI and permissions

- **Create conversation** (HTTP only, pool auth): `--permissions all-members | admin-only`.  
  - `all-members`: Any member can add/remove members and update metadata.  
  - `admin-only`: Only admins can manage members and metadata.
- **Agent tool actions**: Only `send` (text) and `react` (emoji on a message). No create/join/lock/explode from the message tool.
- **Destructive/admin actions** (lock, explode, rename) are exposed as HTTP routes and require pool auth; the in-chat agent cannot call them.

### What the agent can see

- **Sender**: `SenderId` (inbox ID), `SenderName` (when the CLI provides it; otherwise fallback to truncated inbox ID).
- **Message**: `Body` (envelope-formatted), `RawBody`, `MessageSid`, `ChatType: "group"`.
- **Conversation**: `ConversationLabel` (short id), `To` / `OriginatingTo` (conversation id).
- **Time**: Message timestamp is used for envelope ordering; the agent gets `Body` that can include time context per OpenClaw envelope rules.

The agent does **not** receive a full member list or conversation metadata from the extension; only what is in the inbound context above.

### What the agent can and cannot do

- **Can**: Send text (`action=send` with `message`), add/remove reactions (`action=react` with `messageId`, `emoji`, and optional `remove`).
- **Cannot** (from the message tool): Create or join conversations, lock/unlock, explode, rename, or change permissions. Those are done via setup or authenticated HTTP (e.g. pool manager).

### Convos-specific behavior

- **Explode**: Destroys the conversation permanently (all messages and membership). Done via `POST /convos/explode` (pool auth). After explode, the instance is unbound; the agent has no conversation until a new one is created or joined.
- **Lock**: Locks the conversation so new members cannot be added. Unlock via `POST /convos/lock` with `{ "unlock": true }`. Only available over HTTP with pool auth.
- **One-time / ephemeral**: This extension binds to one conversation at a time. If Convos or the CLI supports one-time or ephemeral conversations, creating/joining them is outside the agent’s tool set; the agent only operates inside the already-bound conversation. To “dispose” of a conversation from the system’s point of view, use Explode (then provision a new conversation if needed).
