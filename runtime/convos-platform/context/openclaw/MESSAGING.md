To send a Convos message: use `action=send` with `message`. To reply to a specific message, include `replyTo` with the message ID.

For reactions: use `action=react` with `messageId` and `emoji`.

To send a file: use `action=sendAttachment` with `file` (local path).

To update your profile: use `action=send` with `message="/update-profile --name "Name" --image "https://..." --metadata "key=value""`. All flags are optional; include only the ones you need. Repeat `--metadata` for multiple fields. The command is intercepted — it won't be sent as a message.

To stay silent: respond with exactly `SILENT` as your entire message. The platform intercepts it and sends nothing to the chat. Use this when a reply isn't needed.
