---
title: "TOOLS.md Template"
summary: "Workspace template for TOOLS.md"
read_when:
  - Bootstrapping a workspace manually
---

# TOOLS

Primary channel: **Convos** (group chats and DMs for bookings). Full access: all tools are available.

- **Exec** — Shell commands (full host access, no approval needed)
- **FS** — read, write, edit, apply_patch
- **Browser** — Managed Chrome (profile `openclaw`). Use with profile `openclaw`; start via the tool if needed. Never ask the user to attach the extension or open a tab. https://docs.openclaw.ai/tools/browser

  > **⚠️ CRITICAL — Browser tool REQUIRED PARAMS (MUST read before EVERY call):**
  >
  > **EVERY browser tool call MUST include `target: "host"`.** Without it the call WILL fail with "Sandbox browser is unavailable".
  >
  > 1. **Every call**: `target: "host"` — MANDATORY, no exceptions.
  > 2. **`navigate`**: `target: "host"` AND `targetUrl` with the full URL. Omitting targetUrl → "targetUrl required".
  > 3. **`act`**: `target: "host"` AND `ref` (the element ref string from a prior `snapshot`). Omitting ref → "ref is required". Always `snapshot` first, pick the ref, then `act`.
  > 4. **`act:evaluate`**: `target: "host"` AND a **single expression** (no semicolons, no multi-statement blocks). Return a value: `document.title` ✓ — `const x = 1; return x` ✗.
  > 5. **`snapshot`**: `target: "host"` — no extra params needed beyond target.
  >
  > **NEVER invoke the browser tool without `target: "host"`. NEVER omit `targetUrl` from navigate. These cause immediate failures.**

- **Web Search** — You do NOT have direct `web_search` or `web_fetch`. Spawn `search-subagent` instead.
- **Cron** — Schedule jobs and wakeups
- **Email** — Send and receive emails via the AgentMail skill

# Examples

> Hi!
→ Just reply, no tools.
_Note: Greetings, chitchat, jokes, opinions, general knowledge — just talk. No tools needed._

> What's 2 + 2?
→ Answer directly (4), no tools.
_Note: If you can answer from your own knowledge, never spawn a sub-agent._

> Tell me a joke
→ Answer directly, no tools.
_Note: Never include URLs or citations you didn't actually retrieve via a sub-agent. Making up citations is worse than having none._

> What's the latest news on Elon Musk?
→ search-subagent
_Note: Current/live info requires search. This is the right time to use it._

> Find Italian restaurants in Buenos Aires.
→ search-subagent

> Find the booking page for Don Julio steakhouse.
→ search-subagent
_Note: This only finds the URL. To actually book, browser sub-agent takes over._

> Find the exact address for the Farid restaurant.
→ search-subagent

> Book a table at Don Julio for tonight at 9pm.
→ browser sub-agent
_Note: If no URL is provided, spawn search-subagent first to find the booking page, then delegate to browser._

> Check availability on Resy for 2 people Friday.
→ browser sub-agent

> Send a calendar invite for dinner Friday 9pm to john@email.com.
→ email sub-agent (agentmail)

> Book in Farid restaurant.
→ search-subagent → browser sub-agent
_Note: Multi-step — search finds the page, browser does the booking._

> Reserve at that place and send me an invite.
→ browser sub-agent → email sub-agent (agentmail)

## Common mistakes

| Prompt | Wrong | Right | Why |
|---|---|---|---|
| "Latest news on X" | browser sub-agent | search-subagent | Search, not site interaction |
| "Book a table" | search-subagent | browser sub-agent | Booking needs form interaction |
| "Send invite" | browser sub-agent | email sub-agent | Email delivery, not browsing |
| "Hi" / "What's 2+2" | search-subagent | No tools | Answer directly |
