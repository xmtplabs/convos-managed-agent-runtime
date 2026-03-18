# Context Assembly in the OpenClaw Runtime

How the agent builds its understanding of the world on every message, where we inject our own context, and where the gaps are.

---

## Simple Version

When someone sends a message to a Convos agent, three layers of context get assembled before the LLM sees anything:

1. **Who the agent is** — personality files (SOUL.md, AGENTS.md, IDENTITY.md, TOOLS.md) that define behavior, boundaries, tone, and capabilities. These are baked into the Docker image and copied to the state directory on startup. The LLM reads them as part of its system prompt on every turn.

2. **What's happening in this conversation** — the current group members, custom instructions set when the agent joined, and the current wall-clock time. These are injected per-turn via the `GroupSystemPrompt` field.

3. **What was just said** — the inbound message (wrapped in an envelope with sender name, timestamp, and elapsed time since last message), plus recent conversation history loaded from the session store.

OpenClaw's core (the `openclaw` npm package, which we don't control) merges all three layers into a single prompt and sends it to the configured LLM via OpenRouter.

The agent's response flows back through Convos as an encrypted XMTP message.

---

## Technical Detail

### Startup: Building the Brain

Before the gateway starts, `apply-config.sh` runs:

1. **`sync-openclaw.sh`** rsyncs `runtime/openclaw/workspace/` and `runtime/openclaw/extensions/` into the state directory (`$OPENCLAW_STATE_DIR`, typically `~/.openclaw` locally or `/app` on Railway).

2. **`apply-config.sh`** copies `openclaw.json` to `$STATE_DIR/openclaw.json` and patches it for the environment (port, workspace path, chromium path, plugin load paths).

3. **`gateway.sh`** clears all stale session files (`$STATE_DIR/agents/main/sessions/*.jsonl`) on every restart, then launches the OpenClaw gateway process.

The config tells OpenClaw where to find workspace files:
```json
"agents.defaults.workspace": "~/.openclaw/workspace"
```

**Key consequence: session history does not survive restarts.** Every gateway restart wipes the JSONL session files. The agent starts each process lifecycle with zero conversation memory.

### Workspace Files (Static Context Layer)

These files live in `runtime/openclaw/workspace/` and are synced to the state directory on startup. OpenClaw loads them as part of the system prompt. Each file has YAML frontmatter with `read_when` hints that tell OpenClaw when to include it.

| File | Purpose | Loaded when? |
|------|---------|--------------|
| `SOUL.md` | Core personality — listening philosophy, privacy, how to show up in groups | **Every turn** |
| `AGENTS.md` | Behavioral rules — 3-sentence limit, boundaries, privacy, proactivity rules, loop detection | **Every turn** |
| `IDENTITY.md` | Agent identity entry point; also where custom instructions get written | **Every turn** |
| `TOOLS.md` | Tool usage guide — which tools exist, when to use each, examples, common mistakes | **Every turn** |
| `USER.md` | Template for tracking group members and context (currently never populated — see Gaps) | **Every turn** |
| `HEARTBEAT.md` | Rules for periodic check-ins triggered by cron | **Every turn** |
| `BOOTSTRAP.md` | First-run greeting ritual | **Every turn** |
| `skills/convos-cli/SKILL.md` | In-conversation messaging protocol (send, react, history, members) | When skill is invoked |
| `skills/services/SKILL.md` | Email, SMS, credits | When skill is invoked |
| `skills/bankr/SKILL.md` | Crypto/DeFi operations (opt-in) | When skill is invoked |

**All seven workspace files are loaded on every message turn.** Despite the `read_when` hints in each file's YAML frontmatter (e.g. `read_when: ["Bootstrapping a workspace manually"]`), OpenClaw does not use these as filters. The core function `loadWorkspaceBootstrapFiles` reads all files from disk unconditionally on every reply. The only exception is subagent/cron sessions, which are filtered down to just AGENTS.md and TOOLS.md via `filterBootstrapFilesForSession`.

This means SOUL.md, IDENTITY.md, USER.md, HEARTBEAT.md, and BOOTSTRAP.md are all consuming context window tokens on every single message — even after the first run when BOOTSTRAP.md is no longer relevant. The `read_when` frontmatter is effectively documentation, not a functional gate.

### Message Flow: User Message to LLM Call

The full flow for an inbound message (`channel.ts:352-567`):

```
XMTP message arrives via `convos agent serve` stream
  │
  ├─ Self-echo filtered by CLI (our messages never reach this handler)
  │
  ├─ Member name cache updated (inst.setMemberName)
  │
  ├─ Route resolved (agentId, sessionKey)
  │
  ├─ Previous message timestamp loaded from session store
  │
  ├─ Message wrapped in envelope:
  │     [Convos SenderName +3h Mon, Mar 9, 2026, 2:15 PM EST]
  │     Hey, can you book a table tonight?
  │
  ├─ Image attachments downloaded + MIME type detected (if present)
  │
  ├─ Current wall-clock time formatted (uses configured timezone)
  │
  ├─ finalizeInboundContext() called with full payload ─────────┐
  │                                                              │
  │   Fields passed:                                             │
  │   ├─ Body (envelope-formatted message)                       │
  │   ├─ RawBody / CommandBody (raw text)                        │
  │   ├─ From / To / ConversationId / SessionKey / AccountId     │
  │   ├─ ChatType: "group"                                       │
  │   ├─ SenderName / SenderId                                   │
  │   ├─ GroupSubject (conversation label)                        │
  │   ├─ GroupMembers (cached member name list)                   │
  │   ├─ GroupSystemPrompt ◄──── OUR MAIN INJECTION POINT        │
  │   ├─ MediaPath / MediaType (if image)                        │
  │   └─ Provider / Surface / OriginatingChannel: "convos"       │
  │                                                              │
  ├─ Session recorded (appends to JSONL session file)            │
  │   (skipped for synthetic system messages)                    │
  │                                                              │
  ├─ System events (group_updated, reaction) recorded but        │
  │   do NOT trigger a reply                                     │
  │                                                              │
  └─ dispatchReplyWithBufferedBlockDispatcher() ─────────────────┘
        │
        ├─ OpenClaw core loads conversation history from session store
        ├─ OpenClaw core compiles full system prompt:
        │     workspace files + GroupSystemPrompt + history
        ├─ Sends to LLM via OpenRouter
        ├─ Streams response back
        └─ deliver() callback sends reply via Convos
            (with credit error rewriting if needed)
```

### Our Context Injection Points

#### 1. GroupSystemPrompt (per-turn, channel.ts:493-497)

```typescript
GroupSystemPrompt: [
  account.config?.systemPrompt?.trim(),  // Custom system prompt from config
  `Current time: ${currentTime}`,         // Wall-clock time
  "Before every reply: (1) Need tools? → react 👀 first (2) No text alongside tool calls (3) Does this even need a reply?",
].filter(Boolean).join("\n\n"),
```

This is injected on every single message. It's the most dynamic injection point we have.

**Note:** `account.config?.systemPrompt` reads from `channels.convos.systemPrompt` in the config, but this field does not exist in the `ConvosAccountConfig` TypeScript type. It's effectively dead unless manually added to the JSON. See Gaps below.

#### 2. Custom Instructions via IDENTITY.md (per-conversation, index.ts:16-37)

When the pool manager calls `/convos/conversation` or `/convos/join`, any `instructions` field in the request body gets written to `IDENTITY.md`:

```typescript
function writeInstructions(rawInstructions: unknown) {
  // Appends under "## Custom Instructions" heading
  // Replaces existing block if present (no accumulation)
  fs.writeFileSync(identityPath, identityContent);
}
```

This is a one-time write at conversation join time. The instructions persist in the filesystem for the lifetime of the container but are overwritten if the agent joins a new conversation.

#### 3. Workspace Files (build-time, synced on startup)

SOUL.md, AGENTS.md, TOOLS.md, etc. are our primary way to shape the agent's baseline behavior. Changes require a new image build and redeploy.

#### 4. GroupMembers (per-turn, channel.ts:492)

```typescript
GroupMembers: inst?.getGroupMembers() ?? undefined,
```

A cached map of member inbox IDs to display names, updated from inbound messages. Gives the agent awareness of who's in the room.

#### 5. Envelope Format (per-turn, channel.ts:407-414)

Each message is wrapped with sender name, timestamp, and elapsed time since last message:
```
[Convos Alice +2h Mon, Mar 9, 2026, 2:15 PM EST]
```

This gives the agent time awareness without needing to call any tool.

#### 6. Cron / Heartbeat (system-triggered)

`gateway.sh` seeds a morning check-in cron job (8am ET daily). The cron system sends a synthetic `systemEvent` message that the agent processes like any other inbound message, but it's marked with `SYSTEM_SENDER_ID` so it's not recorded in session history.

---

## Gaps

### 1. Session history does not survive restarts

`gateway.sh` lines 144-152:
```sh
_sessions_dir="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}/agents/main/sessions"
if [ -d "$_sessions_dir" ]; then
  rm -f "$_sessions_dir"/*.jsonl "$_sessions_dir/sessions.json"
fi
```

Every gateway restart wipes all session files. The agent loses all conversation context. On Railway, this happens on every deploy, every crash, and every manual restart.

**Impact:** The agent cannot remember anything said before the last restart. It has no continuity across deploys.

**Why it exists:** Stale session history was causing the agent to see old context and silently skip replies. Wiping was the fix. But this is a sledgehammer — it trades one problem (stale context) for another (amnesia).

### 2. USER.md is never populated

USER.md exists as a template:
```markdown
## Members
_(Who's in the thread. Add nicknames or quirks if the group vibes with it.)_

## Context
_(What they care about, projects, what annoys them...)_
```

But nothing ever writes to it. The agent sees the template on every turn but never fills it in. There's no mechanism for the agent to persist learned context about the group or its members.

The agent _could_ theoretically use its file-write tools to update USER.md, but:
- It would need to be instructed to do so (currently isn't)
- Changes would be overwritten on restart (sync-openclaw.sh rsyncs with `--delete`)

### 3. Memory plugin slot is disabled

`openclaw.json` line 119:
```json
"plugins": {
  "slots": { "memory": "none" }
}
```

OpenClaw has a plugin slot system for memory providers. We've explicitly disabled it. Whatever built-in memory mechanisms OpenClaw might offer, we're not using them.

### 4. `systemPrompt` config field is untyped

`channel.ts:494` reads `account.config?.systemPrompt`, but `ConvosAccountConfig` in `config-types.ts` has no `systemPrompt` field. TypeScript won't error because `account.config` is typed as `ConvosConfig` (which extends `ConvosAccountConfig`), and the field access returns `undefined`.

This means:
- The pool manager never sets it (the type doesn't include it)
- It would only work if someone manually added `"systemPrompt": "..."` to the convos channel config in `openclaw.json`
- It's an available injection point that's currently dead

### 5. No retrieval mechanism for older context

The only way to access conversation history is:
- Recent messages in the session store (recency-based, wiped on restart)
- The `convos conversation messages` CLI command (the agent must explicitly decide to run this)

There's no:
- Semantic search / RAG
- Vector embeddings
- Summarization of old conversations
- Long-term memory store

If someone references something from "last week" and the agent has restarted since then, it has no way to retrieve that context unless it manually runs the CLI history command — and even then, the CLI only fetches from the XMTP network, which has its own retention limits.

### 6. Skills don't contribute context to the system prompt

Skill files (`SKILL.md`) are documentation that OpenClaw may include when the skill is relevant. But skills have no mechanism to _inject_ dynamic context into the system prompt. They're purely instructional — they tell the agent how to use tools, not what the tools have previously returned.

For example: the services skill can check email, but previous email results don't get fed back into the system prompt on the next turn. They only exist in session history (which gets wiped on restart).

### 7. No history limit defaults configured

`ConvosAccountConfig` defines `historyLimit` and `dmHistoryLimit` fields, but neither `openclaw.json` nor the account resolution code sets default values. This means OpenClaw's internal defaults apply, which we don't control or know.

---

## How to Think About Persistent Context

Given the current architecture, there are a few options for providing context that survives across messages and restarts:

### What works today

| Method | Survives restart? | Dynamic? | Scope |
|--------|-------------------|----------|-------|
| Workspace files (SOUL.md, etc.) | Yes (re-synced from image) | No (build-time only) | All conversations |
| Custom instructions (IDENTITY.md) | Yes (written at join time) | One-time at join | Per-conversation |
| GroupSystemPrompt injection | N/A (per-turn) | Yes | Per-turn |
| Session history | **No** (wiped on restart) | Yes | Per-session |
| GroupMembers cache | **No** (in-memory) | Yes | Per-session |

### What's missing

**A durable, per-conversation context store.** Something that:
- Persists across restarts
- Can be written to by the agent (learned preferences, member context, decisions)
- Gets included in the system prompt automatically
- Doesn't get overwritten by sync-openclaw.sh

### Possible approaches

1. **Stop wiping sessions on restart.** The original problem (stale context causing skipped replies) may have better solutions — e.g., trimming old sessions instead of deleting, or adding a staleness marker. This would restore basic continuity.

2. **Enable the memory plugin slot.** OpenClaw has a memory system we've disabled. Investigating what it provides (and why it was disabled) could unlock built-in persistence.

3. **Make USER.md writable and persistent.** Exclude USER.md from the rsync `--delete` in sync-openclaw.sh. Instruct the agent to update it when it learns something important. This gives the agent a "notebook" that survives deploys.

4. **Add a `systemPrompt` field to ConvosAccountConfig** and have the pool manager set it at join time. This activates the dead injection point in GroupSystemPrompt and gives per-conversation system prompt customization a proper path.

5. **Build a context retrieval layer.** When the agent starts a new session, have it automatically run `convos conversation messages` to backfill recent history. This doesn't require any OpenClaw changes — it could be a startup task or a BOOTSTRAP.md instruction.

6. **External memory store.** A simple key-value store (Redis, SQLite on the volume) that the agent can read/write via a tool. Context gets loaded on session start and updated as the agent learns. This is the most robust option but requires the most work.
