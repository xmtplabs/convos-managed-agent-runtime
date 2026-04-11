## 0.3.4

- Privacy guardrails: agents refuse to share private info about other users — dedicated eval enforces boundaries
- LINK marker: URLs sent as separate messages so they unfurl properly in Convos
- Background tasks (Hermes): `convos_background_task` lets agents do async work without blocking replies
- Conversation history fix (Hermes): history now loaded from session DB instead of in-memory, so agents remember across restarts
- Media delivery fix (OpenClaw): attachments dropped by the channel are now delivered via MEDIA marker fallback
- Fatal error handling: retry loop stops immediately on unrecoverable convos CLI errors instead of looping
- NO_REPLY suppression: treated as a SILENT-equivalent so agents can explicitly decline to respond
- Profile image generation (Hermes): twemoji profile images auto-generated from PROFILE: emoji marker
- Directory alignment: both runtimes now share the same directory structure for parity
- Devcontainer: standardized on Node 24 with dev container support
- Web tools: consolidated mini-app into a single tabbed interface with unified styling across landing, services, and skills views

## 0.3.3

- Video understanding: agents can now watch and describe video messages — video is sent to Gemini 2.0 Flash natively via OpenRouter, including speech transcription

## 0.3.2

- Voice memos: agents can now hear voice notes — audio is transcribed via Gemini 2.0 Flash and understood natively, no extra setup needed

## 0.3.1

- Auto-replenish: pool automatically spins up new instances when stock runs low 
- Agent name injection: agents now know their own name in every inbound message, enabling more natural self-references
- Time awareness upgrade: agents know the current timezone (ET) and handle time-related questions more accurately
- Group discipline: agents in group chats are smarter about when to speak and when to stay quiet
- Skills landing page: refreshed layout for browsing and discovering skills
- Reasoning cleanup: agents no longer leak internal reasoning text into replies
- Marker parity: OpenClaw and Hermes now use identical messaging markers 

## 0.3.0

### Big changes

- **Unified pool server** — One server now manages both OpenClaw and Hermes instead of each runtime running its own endpoints
- **Modular agent instructions** — Agent personality and behavior are assembled from small, composable context files at boot instead of one giant file
- **Better web search** — Switched to Exa for faster, more relevant web results
- **New homepage** — Dashboard redesigned around featured skills with a browsable skill directory

### New stuff

- **One-tap skill adopt** — Users can grab pre-built skills instantly, no builder flow needed
- **Instant greeting** — Welcome message shows immediately; onboarding only kicks in when the user actually talks
- **Smarter reactions** — Agents only respond to reactions on their own messages, not everyone's
- **Image support** — Agents can now see and process images (depends on the model)
- **Hermes cron in-session** — Scheduled tasks run inside the main conversation instead of spinning up separate agents
- **Skill categories** — New category picker when tagging skills

### Under the hood

- Simplified env vars — `GATEWAY_TOKEN` replaces the old runtime-prefixed name
- Reorganized `convos-platform/` — cleaner split between shared and runtime-specific files
- All dependencies pinned to exact versions
- Hermes now passes group member info to the agent
- Hermes surfaces credit exhaustion errors to users instead of failing silently

### Fixes

- Web viewer goes straight to the conversation (no more mode selection screen)
- Cleaner web-tool logs — no duplicate snapshots, flat transcript view
- Better delegation behavior
- Hermes no longer leaks internal SILENT markers
- Factory reset properly clears generated skills
- Default agent name is now "Assistant"
- Quieter debug logs
- Fixed orphaned phone number assignments

## 0.2.2
- 2x faster web search powered by Exa
- Email and SMS auto-provision on first use and unprovision when no longer needed
- OpenClaw assistants (really!) no longer narrate tool use — you just see the result
- Fixed model fallback when Anthropic is overloaded, and credit exhaustion alerts from sub-agents

## 0.2.1 — Webhooks
- Real-time email and SMS: notifications are now pushed instantly via webhooks instead of polling every 60 seconds
- Recurring tasks use cron jobs: scheduled agent tasks (morning check-ins, RSS feeds) run on proper cron instead of the poller loop
- On-demand inbox checks still available: agents can manually check email and SMS when asked
- Interrupt-and-queue: agents stop mid-reply when you send a follow-up — no more duplicate or stale responses from rapid messages
- Trajectory sharing: agents can share conversation logs via a link — opt-in only, nothing is shared without explicit consent
- Delegation fix: Hermes agents now properly delegate heavy tasks to sub-agents instead of blocking
- Cron fix: Hermes scheduled tasks now seed correctly on boot
- Reply marker fix: restored reply-to context in agent platform prompts

## 0.2.0 — Skill Builder
- Skill builder: assistants create custom skills in-conversation — discovery questions, scoping, generation, and approval gate
- Model failover: three-deep chain across two providers — overloaded errors rewritten to friendly messages
- Silent notifications: email/SMS polling no longer leaks raw alerts into chat
- Duplicate message fix: no more replayed messages after container restart
- Profile photo safety: agents verify image URLs before setting them

## 0.1.3
- Cleaner instruction architecture — agent instructions reorganized into 5 clear layers so assistants load less redundant context per turn
- Profile management skill — dedicated guidance for name, photo, and metadata updates (shared across both runtimes)
- Platform context now editable without code changes — OpenClaw messaging hints moved from hardcoded TypeScript to a markdown file

## 0.1.2
- Customization guide: agents now know what they can and can't change — including how to create custom skills with polling hooks (see [CUSTOMIZATION.md](shared/workspace/CUSTOMIZATION.md))
- Model switching: users can ask the agent to switch models mid-conversation
- SMS outbound: agents can send outbound SMS messages
- Removed Bankr integration
- Cronjob fix: fixed a regression in scheduled tasks
- Version reporting fix: pool dashboard now correctly shows runtime version for all instances

## 0.1.1
- Faster tool use and smarter memory
- Agents less chatty — assistants stay quiet when they have nothing useful to add

## 0.1.0 — Multi-harness
- Multi-harness: runtime supports both OpenClaw and Hermes engines — same workspace, skills, and agent instructions across both

## 0.0.27
- Background email/SMS polling: new messages are detected and delivered to the chat automatically — no more LLM calls burning credits just to check the inbox
- Email attachments: agents can read full emails and download attachments

## 0.0.26
- Persistent memory: agents build long-term memory over time — facts, preferences, and context from past conversations are recalled automatically
- Image + text merging: sending a photo with a caption no longer triggers two replies — the agent combines them into one message
- Cleaner error messages: credit exhaustion and context overflow show friendly messages instead of raw API errors
- Group cleanup: agents self-destruct when removed from a group, left as the last member, or when the group explodes — no more zombie instances

## 0.0.25
- Sub-agents: agents can now spawn background workers for parallel task execution instead of doing things sequentially
- Self-upgrade: users can ask the agent to "upgrade yourself" and it redeploys to the latest runtime version

## 0.0.24
- OpenClaw upgrade: bumped from 2026.2.15 to 2026.3.8

## 0.0.23
- Friendly credit errors: human-readable messages when credits run out
- Services page redesign: new coupon redemption flow
- Email and SMS opt-in: provisioned on first use instead of at instance creation

## 0.0.22
- Heartbeat polling: agent automatically checks latest email and SMS each cycle

## 0.0.21
- Convos CLI bump: `@xmtp/convos-cli` to ^0.4.0

## 0.0.20
- Time awareness: agents now know the current time — no more guessing
- 👀 reaction: agents react with 👀 to signal multi-step work, then remove it after posting the result
- Morning check-in: daily nudge with substance requirement — skips if there's nothing concrete to share
- Welcome message: shortened to 3 lines (intro + learning + invite)
- Group context: agents know who's in the conversation

## 0.0.19
- Heartbeat: restricted to active hours (8am–10pm ET)

## 0.0.18
- Services dashboard: added credit card section and "top up" button
- Email poll: human-readable output by default

## 0.0.17+
- Unified services: one skill for email, SMS, credits, and identity — no more separate tools
- Provider-agnostic: agent just sees "email", "phone", "credits" — no provider names
- Services dashboard: page showing the agent's email, phone number, and credit balance
- Credits self-service: agents can check their balance and request top-ups

## 0.0.17
- State persistence: agent identity and state survive restarts

## 0.0.16
- Health endpoint: runtime reports its version via `/pool/health`

## 0.0.15
- Credit exhaustion: friendly message when out of credits instead of failing silently

## 0.0.14
- Dependency updates

## 0.0.13
- Fix email inbox polling

## 0.0.12
- SMS: inbound message support, US-only numbers
- Greeting: agents greet automatically when joining a conversation

## 0.0.11
- Voice calls: inbound call support
- Loop guard: prevents agents from getting stuck replying to themselves
- Self-destruct: agents can shut themselves down when no longer needed

---

> **Style guide:** Consumer-facing features only — no internal tooling, CI, infra, or QA changes. Each entry should be something exciting for users. Keep it concise and plain-language.
