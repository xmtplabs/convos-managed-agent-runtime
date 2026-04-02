## Inbound Message Formats

The `content` field of each inbound message depends on its content type:

| contentType | content example |
| --- | --- |
| `text` | `Hello everyone` |
| `reply` | `reply to "Hello everyone" (<message-id>): Thanks!` |
| `reaction` | `reacted 👍 to <message-id>` or `removed 👍 to <message-id>` |
| `group_updated` | Human-readable description (see below) |
| `attachment` | `[attachment: photo.jpg (image/jpeg)]` |
| `remoteStaticAttachment` | `[remote attachment: video.mp4 (4521 bytes) https://...]` |

Replies and reactions reference another message by ID. Replies include the parent message content inline.

group_updated examples (multiple changes joined with `;`):
- `Alice changed group name to "New Name"`
- `Bob joined by invite`
- `Alice added Bob` / `Alice removed Bob` / `Bob left the group`
- `Alice made Bob an admin` / `Alice removed Bob as admin`
- `Bob changed their name to Robert`
- `Alice set conversation expiration to 2026-03-01T00:00:00.000Z`
