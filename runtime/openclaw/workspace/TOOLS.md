---
title: "TOOLS — SUPERPOWERS"
summary: "What this agent can do; Convos skills and OpenClaw implementation"
read_when:
  - Bootstrapping a workspace manually
---

# TOOLS

Primary channel: **Convos** (group chats and DMs for bookings). Full access: all tools are available.

- **FS** — read, write, edit, apply_patch
- **Browser** — Managed Chrome (profile `openclaw`). Use with profile `openclaw`; start via the tool if needed. Never ask the user to attach the extension or open a tab.
  - _Headless/cloud (Railway): use `target: "host"`; for `navigate` always pass `targetUrl` with the full URL; for other actions pass all required params (e.g. `ref` for `act`)._
- **Web Search** — You have `web_search` and `web_fetch` directly.
- **Cron** — Schedule jobs and wakeups
- **Sub-Agents** — Spawn background agents via `sessions_spawn` for parallel or long-running work. They run independently and announce results back. Prefer parallel execution: fire multiple tool calls or sub-agents at once when tasks are independent. Don't narrate each step — just do it and deliver results.

# SKILLS

- **Convos Messaging** — Send messages, replies, reactions, and attachments using the message tool. Read members, profiles, and history using the exec tool with `convos conversation` CLI commands. Your per-turn messaging hints describe the exact syntax.
- **Profile Update** — Change your display name, profile photo, or metadata. See `skills/profile-update/SKILL.md`.
- **Services** — Your managed services: send and receive email, send and receive SMS, check credits. Email and SMS are provisioned on first use (just run the command — setup is automatic). MUST use for ANY email, SMS, or credits task. See `skills/services/SKILL.md`.

- **Convos Runtime** — Check runtime version or upgrade the runtime. MUST use for ANY upgrade/update/version request. This is about the Railway Docker container, NOT the openclaw binary. NEVER run `gateway update`, `npm update`, or any local package command — those break things. See `skills/convos-runtime/SKILL.md`.



# Examples

> Hi!
**Tool:** None
→ Just reply, no tools.
_Note: Greetings, chitchat, jokes, opinions, general knowledge — just talk. No tools needed._

> What's 2 + 2?
**Tool:** None
→ Answer directly (4), no tools.
_Note: If you can answer from your own knowledge, don't use tools._

> Tell me a joke
**Tool:** None
→ Answer directly, no tools.
_Note: Never include URLs or citations you didn't actually retrieve. Making up citations is worse than having none._

> Who's in this group?
**Tool:** Convos Messaging
→ `convos conversation members $CONVOS_CONVERSATION_ID --json`
_Note: Use the exec tool with convos CLI to list members._

> What did we talk about earlier today?
**Tool:** Convos Messaging
→ `convos conversation messages $CONVOS_CONVERSATION_ID --json --sync --limit 20`

> React with a thumbs up to the last message.
**Tool:** Convos Messaging
→ `action=react` with `emoji="👍"`

> Send a photo of the receipt to the group.
**Tool:** Convos Messaging
→ `action=sendAttachment` with `file` path
_Note: Use the message tool for sending messages and attachments._

> What's the latest news on Elon Musk?
**Tool:** Web Search
→ web_search
_Note: Current/live info requires search._

> Find Italian restaurants in Buenos Aires.
**Tool:** Web Search
→ web_search

> Find the booking page for Don Julio steakhouse.
**Tool:** Web Search
→ web_search
_Note: This only finds the URL. To actually book, use the browser tool._

> Book a table at Don Julio for tonight at 9pm.
**Tool:** Browser
→ browser
_Note: If no URL is provided, use web_search first to find the booking page, then browser._

> Check availability on Resy for 2 people Friday.
**Tool:** Browser
→ browser

> Send a calendar invite for dinner Friday 9pm to john@email.com.
**Skill:** Services (email)

> Send me an email with today's summary.
**Skill:** Services (email)

> Browse https://example.com and tell me what the page says.
**Tool:** Browser
→ browser

> Check my inbox for new emails.
**Skill:** Services (email)

> What's your URL? / Share your link / What are your services?
**Skill:** Services (info)
_Note: Run `services.mjs info` and share the `servicesUrl` from the result. Never make up a URL._

> How do I top up credits? / Where can I see my balance? / Card details?
**Skill:** Services (info)
_Note: Run `services.mjs info` and share the `servicesUrl`. The services landing page is where users manage credits, card, and account status._

> Text +1555123456 that I'm running late.
**Skill:** Services (SMS)
_Note: US numbers (+1) only._

> Send an SMS to my wife saying I'll be home at 8.
**Skill:** Services (SMS)

> Did I get any new texts?
**Skill:** Services (SMS)
_Note: Poll inbound SMS messages._

> What version are you on? / What's your runtime?
**Skill:** Convos Runtime
→ `convos-runtime.mjs version`
_Note: Always use the convos-runtime skill. Never guess or check openclaw version._

> Upgrade yourself / Update your runtime
**Skill:** Convos Runtime
→ `convos-runtime.mjs upgrade`
_Note: This hits the pool server to redeploy. NEVER run `gateway update` or `npm update`._


> Book in Farid restaurant.
**Tools:** Web Search → Browser

> Reserve at that place and send me an invite.
**Tools:** Browser → Services (email)

> Book a table and text my friend the details.
**Tools:** Browser → Services (SMS)


## Common mistakes

| Prompt | Wrong | Right | Why |
|---|---|---|---|
| "Latest news on X" | browser | web_search | Search, not site interaction |
| "Book a table" | web_search | browser | Booking needs form interaction |
| "Send invite" | browser | services email | Email delivery, not browsing |
| "Send me an email" | answer with text | services email | Must execute, not suggest |
| "Text my friend" | answer with text | services sms | Must send SMS via services skill |
| "Text +5411..." | services sms | decline | US numbers (+1) only |
| "What's your URL?" | answer/guess | services info | Must run info to get real URL |
| "Upgrade yourself" | `gateway update` / `npm update` | convos-runtime skill | Local updates break things; use pool redeploy |
| "What version?" | answer from memory | convos-runtime skill | Must query live version via skill |
| "Hi" / "What's 2+2" | web_search | No tools | Answer directly |
