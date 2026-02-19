# Convos Extension — Known Issues & TODOs

## 🔴 Insecure Private Key Storage

**Priority: High**

The convos-cli stores identity private keys (secp256k1 wallet keys + DB encryption keys) as plaintext JSON files in `~/.convos/identities/<id>.json`. These keys are the root of trust for each conversation — anyone with access to the file can impersonate the agent and decrypt the XMTP database.

Current state:
- `walletKey`: hex-encoded private key, stored in plaintext
- `dbEncryptionKey`: 32-byte hex key, stored in plaintext
- No file permission restrictions beyond default umask
- No encryption at rest
- On Railway containers this is somewhat contained (ephemeral filesystem), but on local dev machines it's a real risk

Needs investigation:
- What's the right storage mechanism? OS keychain (macOS Keychain, Linux secret service)? Encrypted file with a master password? Environment variable injection?
- How does this interact with the pool manager provisioning flow? Containers are ephemeral but keys need to survive process restarts within a container lifecycle.
- The convos iOS app uses iOS Keychain with device-only access (kSecAttrAccessibleWhenUnlockedThisDeviceOnly). The CLI equivalent would be the OS keychain.

This is a convos-cli issue, not an extension issue — the extension only stores the identity *ID*, not the keys themselves.

## ✅ Self-Echo Filtering (Fixed)

**Resolved by agent-serve migration.**

The current extension has three redundant self-echo filters, none fully reliable:

1. **Content matching** (`sdk-client.ts`): Tracks recently sent message content in a Set. Matches echoed messages by content to learn `selfInboxId`. Fragile — content collisions, race conditions, Set size limits.

2. **Message ID tracking** (`outbound.ts`): Tracks sent message IDs in `recentSentIds` Set (capped at 100). Checked in `handleInboundMessage`. Slightly better but IDs could rotate out before the echo arrives.

3. **Sender ID check** (`channel.ts`): Checks `msg.senderId === inst.identityId`. This is the most correct approach but `identityId` is the *identity store ID*, not the XMTP inbox ID, so it may not match `senderInboxId` from the stream.

`convos agent serve` solves this correctly: it filters by `message.senderInboxId === client.inboxId` inside the CLI process itself, so echoes never reach stdout. All three filters have been removed from the extension.
