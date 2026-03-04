---
name: convos-cli
description: |
  In-conversation messaging for an active Convos agent session.
  USE WHEN: Sending messages, replies, reactions, or attachments in the current conversation. Reading message history, checking who is in the group, viewing profiles or permissions.
  DON'T USE WHEN: Managing identities, creating conversations, or anything outside the current conversation.
---

# Convos — In-Conversation Reference

You are inside a running `convos agent serve` session. You are one member of a single conversation. Everything below is the protocol for participating in it.

The environment variable `$CONVOS_CONVERSATION_ID` is always set to your conversation's hex ID. Use it directly in all CLI commands — never hard-code or look up the ID yourself.

## Receiving Events

Events arrive as ndjson on stdout. Each has an `event` field.

| Event | Meaning | Key fields |
| ----- | ------- | ---------- |
| `message` | Someone sent a message | `id`, `senderInboxId`, `content`, `contentType`, `sentAt`, `senderProfile` (optional: `{ name?, image? }`) |
| `member_joined` | A new member was added | `inboxId`, `conversationId` |
| `sent` | Your message was delivered | `id`, `text`, `replyTo` |
| `error` | Something went wrong | `message` |

### Message content formats

The `content` field is always a normalized string. The format depends on `contentType`:

| contentType typeId | content example |
| --- | --- |
| `text` | `Hello everyone` |
| `reply` | `reply to "Hello everyone" (<message-id>): Thanks!` |
| `reaction` | `reacted 👍 to <message-id>` or `removed 👍 to <message-id>` |
| `group_updated` | See below |
| `attachment` | `[attachment: photo.jpg (image/jpeg)]` |
| `remoteStaticAttachment` | `[remote attachment: video.mp4 (4521 bytes) https://...]` |

### Replies, reactions, and context

Replies and reactions both reference another message by ID. Replies include the parent message content inline when available (e.g. `reply to "Hello everyone" (abc123): Thanks!`). Reactions reference by ID (e.g. `reacted 👍 to abc123`). If you need more context about a referenced message, look it up in the messages you have already seen in the stream. If you haven't seen it, fetch recent history with `convos conversation messages $CONVOS_CONVERSATION_ID --json --sync --limit 50`.

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
- `Alice set their profile name`
- `Bob changed their name to Robert`
- `Alice updated their profile photo`
- `Alice removed their profile photo`
- `Alice rotated the invite tag` (all existing invite links are now invalid)
- `Alice set conversation expiration to 2026-03-01T00:00:00.000Z`

## Two interfaces

| I want to... | Use | Tool |
| --- | --- | --- |
| Send a message | message tool | `action=send` |
| Reply to a message | message tool | `action=send` + `replyTo` |
| React to a message | message tool | `action=react` |
| Send a file | message tool | `action=sendAttachment` |
| Read message history | exec tool | `convos conversation messages $CONVOS_CONVERSATION_ID` |
| List members / profiles | exec tool | `convos conversation members` / `profiles $CONVOS_CONVERSATION_ID` |
| View group info | exec tool | `convos conversation info` / `permissions $CONVOS_CONVERSATION_ID` |
| Download a received file | exec tool | `convos conversation download-attachment $CONVOS_CONVERSATION_ID` |
| Update your display name | exec tool | `convos conversation update-profile $CONVOS_CONVERSATION_ID` |

The message tool is for **sending**. The exec tool is for **reading and profile management**. Never use the exec tool to send.

## Sending (message tool)

### Text

```
action=send  message="Plain text only"
```

### Reply

```
action=send  message="Responding to that"  replyTo="<message-id>"
```

Always reply to the specific message you are responding to. This keeps threads legible. Only reply to actual messages (text, reply, attachment) — never to system events like group_updated, reactions, or member joins. If you're responding to a system event, send a plain message without replyTo.

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

## Reading and profile management (exec tool)

These operations use the `convos` CLI via the exec tool. Always use `$CONVOS_CONVERSATION_ID` for the conversation ID — it is always set in your environment. Always pass `--json` when you need to parse the output.

### Who is in the group

```bash
convos conversation members $CONVOS_CONVERSATION_ID --json
convos conversation profiles $CONVOS_CONVERSATION_ID --json
```

`members` returns inbox IDs and permission levels. `profiles` returns display names and avatars. Members without a profile appear as anonymous.

Refresh profiles when you see a `member_joined` event or a `group_updated` message about profile changes (e.g. "Alice set their profile name"). This keeps your name mapping current.

### Message history

```bash
convos conversation messages $CONVOS_CONVERSATION_ID --json --sync --limit 20
convos conversation messages $CONVOS_CONVERSATION_ID --json --limit 50 --direction ascending
```

Use `--sync` to pull the latest from the network before listing. Use `--content-type text` or `--exclude-content-type reaction` to filter. Use `--sent-after <ns>` / `--sent-before <ns>` for time ranges (nanosecond timestamps).

### Group info and permissions

```bash
convos conversation info $CONVOS_CONVERSATION_ID --json
convos conversation permissions $CONVOS_CONVERSATION_ID --json
```

### Download a received attachment

```bash
convos conversation download-attachment $CONVOS_CONVERSATION_ID <message-id>
convos conversation download-attachment $CONVOS_CONVERSATION_ID <message-id> --output ./photo.jpg
```

### Update your profile

```bash
convos conversation update-profile $CONVOS_CONVERSATION_ID --name "New Name"
convos conversation update-profile $CONVOS_CONVERSATION_ID --name "New Name" --image "https://example.com/avatar.jpg"
```

Your profile is per-conversation — it only affects this group.

## Rules

- **Plain text only.** Convos does not render markdown. Never use `**bold**`, `*italic*`, `` `code` ``, `[links](url)`, or list markers like `- ` or `* `. Write naturally.
- **Every message costs everyone's attention.** Only speak when it adds something no one else in the room could. When in doubt, stay quiet.
- **Reply, don't broadcast.** Use `replyTo` so people know what you are responding to.
- **Reactions are cheap, messages are expensive.** If acknowledgment is enough, react instead of typing.
- **Honor renames immediately.** When someone gives you a new name (conversationally or via a group update), run `convos conversation update-profile $CONVOS_CONVERSATION_ID --name "NewName"` right away. Do not announce you are going to do it — just do it and confirm the new name.
- **You cannot rename the group.** There is no CLI command or tool action to change the conversation/group name. If someone asks you to rename the group, let them know you can't do that — only human members can rename it from their app.
- **Always use `$CONVOS_CONVERSATION_ID`.** Never hard-code a conversation ID or try to read it from context fields. The env var is always correct.
- **Never run the `convos` binary directly.** Only use the specific `convos conversation ...` read commands listed above (messages, members, profiles, info, permissions, download-attachment, update-profile). Never run `convos agent serve`, `convos conversations create`, `convos conversations join`, or any other subcommand — they will fail or break your session.
- **Know who you're talking to.** Fetch profiles at the start of every conversation. Use names, not inbox IDs, when referring to people. Refresh profiles when someone joins or when you see a `Group updated` event.
- **Don't narrate your actions or expose internals.** Never announce what tool you're about to use, explain the steps you're taking, or reference technical details like metadata, app data, inbox IDs, or content types. People in the chat don't know or care how you work — just talk like a person.
