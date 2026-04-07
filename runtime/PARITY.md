# Runtime Parity

Cross-runtime audit of OpenClaw (Node.js) and Hermes (Python). Last updated April 7 2026.

Approach: file-by-file comparison across channel logic, stats, agent runner, server, and boot scripts. Each feature verified against `dev` HEAD.

## Consistent features

| Feature | OpenClaw | Hermes | Notes |
|---|---|---|---|
| **Outbound policy** | `outbound-policy.ts` | `outbound_policy.py` | Both load shared `outbound-policy.json`. Same suppress/rate-limit/credit/overload logic. |
| **Message chunking** | `channel.ts` (4000 chars) | `channel.py` (4000 chars) | Same limit, markdown-aware splitting. |
| **Markdown stripping** | `channel.ts:1046-1062` | `channel.py:160-168` | Same regex set. |
| **Companion image hold** | `COMPANION_SETTLE_MS=1500` | `COMPANION_SETTLE_S=1.5` | Same 1.5s window, same hold/merge pattern. |
| **Profile markers** | `PROFILE:`, `PROFILEIMAGE:` | Same markers | Both parse and strip before sending. |
| **Own-reaction triggering** | Triggers turn only on reactions to own messages | Same | Consistent behavior. |
| **Profile image renewal** | On activity | On activity | Both renew on message activity. |
| **Suppress tokens** | `HEARTBEAT_OK`, `SILENT` | Same | Both strip lines with these tokens. |
| **Greeting & skill-builder injection** | `channel.ts:1150-1170` | `server.py:212-245` | Both send static greeting from `static-greeting.md`, both inject skill-builder kickoff lazily if no active skill. |
| **Observability / stats** | `stats.ts` | `stats.py` | Full PostHog integration: same 4 counters (`messages_in/out`, `tools_invoked`, `skills_invoked`), same 4 gauges (`group_member_count`, `memory_gb`, `cron_job_count`, `skills_created_count`), 60s batch flush, idle detection, schema v1. |
| **Eyes auto-removal** | `channel.ts` | `channel.py:632-637` | Both auto-remove eyes reaction after dispatch. |
| **Marker parsing** | `parse-markers.ts` | `channel.py:101-157` | All 6 markers: `REACT:`, `REPLY:`, `MEDIA:`, `PROFILE:`, `PROFILEIMAGE:`, `METADATA:`. |
| **File layout** | `channel.ts`, `sdk-client.ts`, `actions.ts` | `channel.py`, `sdk_client.py`, `actions.py` | Matching file names. |
| **Interrupt** | Gateway-level interrupt mode | `channel.py:340-645` interrupt-and-queue | Both support interrupting active runs. Different mechanisms (gateway vs app-level queue). |
| **Self-destruct / expiration** | Pool-server + extension | `channel.py:720-756` | Both handle expiration and self-destruct. |
| **Tool surface** | `send`, `react`, `sendAttachment` | `convos_react`, `convos_send_attachment` | Intentional design difference. Hermes has no explicit `send` — final text dispatched automatically. |
| **Marker docs** | MESSAGING.md | MESSAGING.md | Both document `REPLY:`, `REACT:`, `MEDIA:` markers. |
| **Temp image cleanup** | `channel.ts:147-167` | `channel.py:273-290` | Both prune `convos-img-*` files older than 1hr, throttled to every 5min. |
| **Reasoning suppression** | `channel.ts:818-879` buffer-flush | `agent_runner.py:322-356` post-hoc extraction | Different mechanisms, same user-facing behavior (reasoning hidden). Eval suite validates parity. |

## Inconsistencies

### 1. Delivery queue cleanup — OpenClaw only (intentional)

- **OpenClaw**: Clears stale `delivery-queue/*.json` on startup (`channel.ts:383-403`) to prevent duplicate sends after SIGKILL.
- **Hermes**: No delivery queue. Uses in-memory state — different architecture, no disk persistence.

Intentional. No action needed.

### 2. Cron job integration — Hermes richer than OpenClaw

- **Hermes**: Monkey-patches cron scheduler (`server.py:697-837`) to wake the main session, intercept `run_job`, and handle credit errors with user notification.
- **OpenClaw**: Only reads the cron jobs file for metrics (`channel.ts:1328-1330`). No session waking or credit error handling.

**Impact**: Credit exhaustion during cron jobs only surfaced to users in Hermes.

### 3. Async task cancellation on stop — Hermes only

- **Hermes**: Explicitly cancels `flush_task` and `download_task` on stop (`channel.py:414-418`).
- **OpenClaw**: No explicit pending task lifecycle management on stop.

**Impact**: OpenClaw may leave in-flight operations hanging on shutdown.

### 4. Attachment download failure handling

- **OpenClaw**: Silently drops failed downloads (`channel.ts:633, 646`), fire-and-forget.
- **Hermes**: Awaits download task completion before proceeding (`channel.py:705`).

**Impact**: Different UX on failed image downloads.

### 5. Memory usage reporting — platform-specific

- **OpenClaw**: `process.memoryUsage().rss` (`stats.ts:46`).
- **Hermes**: `resource.getrusage` with platform-specific KB-to-bytes conversion (`stats.py:58-62`).

**Impact**: Memory metrics may differ slightly between runtimes in dashboards.

### 6. Stale comment in OpenClaw reasoning suppression

`channel.ts:822` says "All text is delivered" but reasoning is actually dropped (line 835). Comment predates the change.
