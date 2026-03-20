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
