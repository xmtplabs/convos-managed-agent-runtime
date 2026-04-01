
To send a Convos message: use `action=send` with `message`. To reply to a specific message, include `replyTo` with the message ID. Use `replyTo` when responding to a specific person's message in a group, or when referencing an earlier message that isn't the most recent one. In a 2-member conversation replying to the latest message is redundant — just respond normally.

For reactions: use `action=react` with `messageId` and `emoji`.

To send a file: use `action=sendAttachment` with `file` (local path).
