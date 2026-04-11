# Runtime Parity

Cross-runtime audit of OpenClaw (Node.js) and Hermes (Python). Last updated April 11 2026.

Approach: file-by-file comparison across channel logic, stats, agent runner, server, and boot scripts. Each feature verified against `dev` HEAD.

## Consistent features

| Feature | OpenClaw | Hermes | Notes |
|---|---|---|---|
| **Outbound policy** | `outbound-policy.ts` | `outbound_policy.py` | Both load shared `outbound-policy.json`. Same suppress/rate-limit/credit/overload logic. |
| **Message chunking** | `channel.ts` (4000 chars) | `channel.py` (4000 chars) | Same limit, markdown-aware splitting. |
| **Markdown stripping** | `channel.ts:1294-1310` | `channel.py:304-312` | Same regex set. |
| **Companion image hold** | `COMPANION_SETTLE_MS=1500` | `COMPANION_SETTLE_S=1.5` | Same 1.5s window, same hold/merge pattern. |
| **Profile markers** | `PROFILE:`, `PROFILEIMAGE:` | Same markers | Both parse and strip before sending. |
| **Own-reaction triggering** | Triggers turn only on reactions to own messages | Same | Consistent behavior. |
| **Profile image renewal** | On activity | On activity | Both renew on message activity. |
| **Suppress tokens** | `HEARTBEAT_OK`, `SILENT`, `NO_REPLY` | Same | Both load from shared `outbound-policy.json`. `NO_REPLY` added in #1007. |
| **Greeting & skill-builder injection** | `channel.ts:1414-1430` | `server.py:212-245` | Both send static greeting from `static-greeting.md`, both inject skill-builder kickoff lazily if no active skill. |
| **Observability / stats** | `stats.ts` | `stats.py` | Full PostHog integration: same 4 counters (`messages_in/out`, `tools_invoked`, `skills_invoked`), same 4 gauges (`group_member_count`, `memory_gb`, `cron_job_count`, `skills_created_count`), 60s batch flush, idle detection, schema v1. |
| **Eyes auto-removal** | `channel.ts:1119-1125` | `channel.py:1051-1054` | Both auto-remove eyes reaction after dispatch. |
| **Marker parsing** | `parse-markers.ts` | `channel.py:233+` | All 7 markers: `REACT:`, `REPLY:`, `MEDIA:`, `PROFILE:`, `PROFILEIMAGE:`, `METADATA:`, `LINK:`. `LINK:` added in #1019. |
| **File layout** | `channel.ts`, `sdk-client.ts`, `actions.ts` | `channel.py`, `sdk_client.py`, `actions.py` | Matching file names. |
| **Interrupt** | Gateway-level interrupt mode | `channel.py:340-645` interrupt-and-queue | Both support interrupting active runs. Different mechanisms (gateway vs app-level queue). |
| **Self-destruct / expiration** | Pool-server + extension | `channel.py:720-756` | Both handle expiration and self-destruct. |
| **Tool surface** | `send`, `react`, `sendAttachment` | `convos_react`, `convos_send_attachment` | Intentional design difference. Hermes has no explicit `send` — final text dispatched automatically. |
| **Marker docs** | MESSAGING.md | MESSAGING.md | Both document `REPLY:`, `REACT:`, `MEDIA:` markers. |
| **Temp image cleanup** | `channel.ts:147-167` | `channel.py:273-290` | Both prune `convos-img-*` files older than 1hr, throttled to every 5min. |
| **Voice memo transcription** | `channel.ts` | `channel.py` | Both detect audio attachments (.m4a, .ogg, .mp3, etc.), download, send to Gemini 2.0 Flash via OpenRouter `input_audio` content blocks, and re-dispatch as `[Audio] transcript`. Eyes shown during transcription. No local whisper or extra API keys. |
| **Video understanding** | `channel.ts` | `channel.py` | Both detect video attachments (.mp4, .mov, .webm, .mpeg), download, send to Gemini 2.0 Flash via OpenRouter `video_url` content blocks (base64 data URL), and re-dispatch as `[Video] description`. Eyes shown during processing. Model describes visuals and transcribes speech. |
| **Reasoning suppression** | `channel.ts:1051-1065` buffer-flush | `agent_runner.py:412-446` post-hoc extraction | Different mechanisms, same user-facing behavior (reasoning hidden). Eval suite validates parity. |
| **Fatal error self-healing** | `sdk-client.ts` + `channel.ts` | `sdk_client.py` | Both capture stderr, match against `FATAL_STDERR_PATTERNS` (e.g. "No identity found for conversation"), and skip retry loop on non-retryable errors. OpenClaw channel layer also blocks instead of throwing to prevent framework auto-restart. |
| **Conversation history persistence** | Framework-managed session store via `runtime.channel.session.recordInboundSession` (`channel.ts:939`) | Upstream Hermes `SessionDB` SQLite at `$HERMES_HOME/state.db`, with a `conversation_id → session_id` pointer in `$HERMES_HOME/convos_session.json` so the runtime resumes the right session after a process restart (`agent_runner.py:186-261`) | Both persist the full message trajectory (including tool calls and tool results) to disk, and both survive process restarts. Different storage layers (framework session store vs upstream Hermes `SessionDB`), same outcome. |

## Inconsistencies

### 1. Delivery queue cleanup — OpenClaw only (intentional)

- **OpenClaw**: Clears stale `delivery-queue/*.json` on startup (`channel.ts:522-542`) to prevent duplicate sends after SIGKILL.
- **Hermes**: No outbound delivery queue — sends happen inline within each turn, so there's nothing to persist or replay on the outbound path. (Inbound conversation history *is* persisted to disk via `state.db` — see the Conversation history persistence row above.)

Intentional. No action needed.

### 2. Cron job integration — Hermes richer than OpenClaw

- **Hermes**: Monkey-patches cron scheduler (`server.py:697-837`) to wake the main session, intercept `run_job`, and handle credit errors with user notification.
- **OpenClaw**: Only reads the cron jobs file for metrics (`channel.ts:1582-1584`). No session waking or credit error handling.

**Impact**: Credit exhaustion during cron jobs only surfaced to users in Hermes.

### 3. Async task cancellation on stop — Hermes only

- **Hermes**: Explicitly cancels `flush_task` and `download_task` on stop (`channel.py:572-575`).
- **OpenClaw**: No explicit pending task lifecycle management on stop.

**Impact**: OpenClaw may leave in-flight operations hanging on shutdown.

### 4. Attachment download failure handling

- **OpenClaw**: Silently drops failed downloads, fire-and-forget.
- **Hermes**: Awaits download task completion before proceeding.

**Impact**: Different UX on failed image downloads.

### 5. Memory usage reporting — platform-specific

- **OpenClaw**: `process.memoryUsage().rss` (`stats.ts:46`).
- **Hermes**: `resource.getrusage` with platform-specific KB-to-bytes conversion (`stats.py:58-62`).

**Impact**: Memory metrics may differ slightly between runtimes in dashboards.

### 6. Stale comment in OpenClaw reasoning suppression

`channel.ts:1051` says "All text is delivered" but reasoning is actually dropped (line 1064). Comment predates the change.

### 7. Background task system — Hermes only

- **Hermes**: `spawn_background_task` / `check_background_task` tools (`channel.py:498-767`) allow non-blocking async work with progress tracking. 10-minute wall-clock timeout. Added in #1014.
- **OpenClaw**: No equivalent. Long-running work blocks the turn.

**Impact**: Hermes agents can offload slow tasks (web scraping, data processing) without blocking conversation. OpenClaw agents cannot.
