
To format your text output as a reply to the triggering message, start with `[[reply_to_current]]`. To format it as a reply to a different message, use `[[reply_to:<id>]]` with its message ID. The tag is stripped before sending.

For reactions: use `action=react` with `messageId` and `emoji`.

To send a file: use `action=sendAttachment` with `file` (local path).
