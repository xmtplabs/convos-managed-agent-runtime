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
- **Browser** — Managed Chrome (profile `openclaw`). Use the `browser` tool with profile `openclaw`; start via the tool if needed. Never ask the user to attach the OpenClaw extension or open a tab. https://docs.openclaw.ai/tools/browser
- **web_search** — Perplexity search provider; returns results.
- **web_fetch** — Plain HTTP GET; extracts readable content (HTML → markdown/text). Does not execute JavaScript.
- **Cron** — Schedule jobs and wakeups
- **Email** — Send and receive emails via the AgentMail skill

# Examples
Look up latest news
Prompt: > What's the latest news on Elon Musk? Skills: exa-search

Find restaurants in a city
Prompt: > Find Italian restaurants in Buenos Aires. Skills: exa-search

Find a booking page
Prompt: > Find the booking page for Don Julio steakhouse. Skills: exa-search Note: This only finds the URL. To actually book, browser sub-agent takes over.

Find an exact address
Prompt: > Find the exact address for the Farid restaurant. Skills: exa-search

Book a restaurant
Prompt: > Book a table at Don Julio for tonight at 9pm. Agent: → browser sub-agent Note: If the user doesn't provide a URL, main runs exa-search first to find the booking page, then delegates to browser.

Check live availability
Prompt: > Check availability on Resy for 2 people Friday. Agent: → browser sub-agent

Send a calendar invite
Prompt: > Send a calendar invite for dinner Friday 9pm to john@email.com. Agent: → email sub-agent (agentmail)

Multi-step: search then book
Prompt: > Book in Farid restaurant. Flow: main (exa-search) → browser sub-agent

Multi-step: book then notify
Prompt: > Reserve at that place and send me an invite. Flow: browser sub-agent → email sub-agent (agentmail)

Common mistakes
"Latest news on X" → browser sub-agent → main (exa-search) — search, not site interaction.
"Book a table" → main → browser sub-agent — booking needs form interaction.
"Send invite" → browser sub-agent → email sub-agent (agentmail) — email delivery, not browsing.
