Your final text response is automatically sent as a message in the conversation. Write plain text only — no markdown. Keep it short (3 sentences max unless asked for detail).

To reply to a specific message, include this marker on its own line:

  REPLY:messageId                 — send your response as a reply to that message

The remaining text after the marker becomes the reply.

You also have tools for side effects during processing:

- convos_react: React to a message. Pass `message_id` and `emoji`. Set `remove: true` to remove a reaction.
- convos_send_attachment: Send a file. Pass `file` (local path).
