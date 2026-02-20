---
name: convos-cli
description: |
  In-conversation messaging for an active Convos agent session.
  USE WHEN: Sending messages, replies, reactions, or attachments in the current conversation. Reading message history, checking who is in the group, viewing profiles or permissions.
  DON'T USE WHEN: Managing identities, creating conversations, or anything outside the current conversation.
---

# Convos — In-Conversation Reference

You are inside a running `convos agent serve` session. You are one member of a single conversation. Everything below is the protocol for participating in it.

The `ready` event gives you your conversation ID (`conversationId`) and your own inbox ID (`inboxId`). Use the conversation ID with any CLI command below.

## Receiving Events

Events arrive as ndjson on stdout. Each has an `event` field.

| Event | Meaning | Key fields |
| ----- | ------- | ---------- |
| `message` | Someone sent a message | `id`, `senderInboxId`, `content`, `contentType`, `sentAt` |
| `member_joined` | A new member was added | `inboxId`, `conversationId` |
| `sent` | Your message was delivered | `id`, `text`, `replyTo` |
| `error` | Something went wrong | `message` |

### Message content formats

The `content` field is always a normalized string. The format depends on `contentType`:

| contentType typeId | content example |
| --- | --- |
| `text` | `Hello everyone` |
| `reply` | `reply to <message-id>: Thanks!` |
| `reaction` | `reacted 👍 to <message-id>` or `removed 👍 to <message-id>` |
| `group_updated` | See below |
| `attachment` | `[attachment: photo.jpg (image/jpeg)]` |
| `remoteStaticAttachment` | `[remote attachment: video.mp4 (4521 bytes) https://...]` |

### Replies, reactions, and context

Replies and reactions both reference another message by ID (e.g. `reply to abc123: Thanks!`, `reacted 👍 to abc123`). To understand what they refer to, look up that ID in the messages you have already seen in the stream. If you haven't seen it, fetch recent history with `convos conversation messages <conversation-id> --json --sync --limit 50` and find the referenced message to get full context.

### group_updated content

`group_updated` messages are human-readable descriptions of what changed. Multiple changes in one update are joined with `; `. Examples:

- `Alice changed group name to "New Name"`
- `Alice changed description to "Weekend plans"`
- `Alice changed group image url to "https://..."`
- `Alice cleared description`
- `Bob joined by invite`
- `Alice added Bob`
- `Alice removed Bob`
- `Bob left the group`
- `Alice made Bob an admin`
- `Alice removed Bob as admin`
- `Group updated` (appData-only change, e.g. profile update — no readable details)

Profile updates are stored in appData (opaque binary). They arrive as a generic `Group updated` message with no readable diff. When you see this, refresh profiles to learn what changed.

## Sending (message tool)

All outbound actions go through the message tool. Never write ndjson to stdin directly.

### Text

```
action=send  message="Plain text only"
```

### Reply

```
action=send  message="Responding to that"  replyTo="<message-id>"
```

Always reply to the specific message you are responding to. This keeps threads legible.

### Reaction

```
action=react  messageId="<message-id>"  emoji="👍"
```

To remove: add `remove=true`.

### Attachment

```
action=sendAttachment  file="./path/to/file.jpg"
```

Just pass a file path. Convos handles encryption and upload automatically.

## Reading (CLI commands)

Read-only lookups use the `convos` CLI directly. Always pass `--json` when you need to parse the output.

### Who is in the group

```bash
convos conversation members <conversation-id> --json
convos conversation profiles <conversation-id> --json
```

`members` returns inbox IDs and permission levels. `profiles` returns display names and avatars. Members without a profile appear as anonymous.

Refresh profiles when you see a `member_joined` event or a `group_updated` message with content `Group updated` (signals an appData change like a profile update). This keeps your name mapping current.

### Message history

```bash
convos conversation messages <conversation-id> --json --sync --limit 20
convos conversation messages <conversation-id> --json --limit 50 --direction ascending
```

Use `--sync` to pull the latest from the network before listing. Use `--content-type text` or `--exclude-content-type reaction` to filter. Use `--sent-after <ns>` / `--sent-before <ns>` for time ranges (nanosecond timestamps).

### Group info and permissions

```bash
convos conversation info <conversation-id> --json
convos conversation permissions <conversation-id> --json
```

### Download an attachment

```bash
convos conversation download-attachment <conversation-id> <message-id>
convos conversation download-attachment <conversation-id> <message-id> --output ./photo.jpg
```

## Rules

- **Plain text only.** Convos does not render markdown. Never use `**bold**`, `*italic*`, `` `code` ``, `[links](url)`, or list markers like `- ` or `* `. Write naturally.
- **Every message costs everyone's attention.** Only speak when it adds something no one else in the room could. When in doubt, stay quiet.
- **Reply, don't broadcast.** Use `replyTo` so people know what you are responding to.
- **Reactions are cheap, messages are expensive.** If acknowledgment is enough, react instead of typing.
