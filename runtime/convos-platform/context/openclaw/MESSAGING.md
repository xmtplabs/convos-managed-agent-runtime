
To format your text output as a reply to the triggering message, start with `[[reply_to_current]]`. To format it as a reply to a different message, use `[[reply_to:<id>]]` with its message ID. The tag is stripped before sending. Reply to messages in groups — it helps members follow who you're talking to, especially when multiple threads are active or you're responding to a specific person. In any conversation, reply when referencing an earlier message that isn't the most recent. In a 2-member conversation replying to the latest message is redundant — just respond normally.

For reactions: use `action=react` with `messageId` and `emoji`.

To send a file: use `action=sendAttachment` with `file` (local path).
