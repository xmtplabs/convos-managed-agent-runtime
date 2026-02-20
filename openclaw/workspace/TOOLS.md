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
  - _Headless/cloud (Railway, CHROMIUM_PATH): use `target: "host"`; for `navigate` always pass `targetUrl` with the full URL; for other actions pass all required params (e.g. `ref` for `act`)._
- **Web Search** — You have `web_search` and `web_fetch` directly.
- **Cron** — Schedule jobs and wakeups

# SKILLS

- **Convos (convos-cli)** — Your conversation. Send messages, replies, reactions, attachments; read members, profiles, history. See `skills/convos-cli/SKILL.md` for the full protocol reference.
- **Email (AgentMail)** — Send and receive emails, calendar invites, poll inbox. MUST use for ANY email task. Run scripts as `node $OPENCLAW_STATE_DIR/workspace/skills/agentmail/scripts/<script>.mjs ...`
- **SMS (Telnyx)** — Send and receive SMS messages. **US numbers only** (+1). If the recipient is outside the US, tell the user SMS is not available for that destination and suggest email instead. MUST use for ANY SMS/text message task. Run via `telnyx message send --from $TELNYX_PHONE_NUMBER --to <number> --text "message"`.
- **Crypto (Bankr)** — Trade, transfer, check balances, deploy tokens, manage portfolio. MUST use for ANY crypto/DeFi task. Run via `bankr prompt "natural language instruction"` or the REST API at `https://api.bankr.bot`.



# Examples

> Hi!
→ Just reply, no tools.
_Note: Greetings, chitchat, jokes, opinions, general knowledge — just talk. No tools needed._

> What's 2 + 2?
→ Answer directly (4), no tools.
_Note: If you can answer from your own knowledge, don't use tools._

> Tell me a joke
→ Answer directly, no tools.
_Note: Never include URLs or citations you didn't actually retrieve. Making up citations is worse than having none._

> What's the latest news on Elon Musk?
→ web_search
_Note: Current/live info requires search._

> Find Italian restaurants in Buenos Aires.
→ web_search

> Find the booking page for Don Julio steakhouse.
→ web_search
_Note: This only finds the URL. To actually book, use the browser tool._

> Go fill out and submit https://convos-agent-main.up.railway.app/web-tools/form
→ browser 
_Note: If no URL is provided, use web_search first to find the booking page, then browser._


> Book a table at Don Julio for tonight at 9pm.
→ browser
_Note: If no URL is provided, use web_search first to find the booking page, then browser._

> Check availability on Resy for 2 people Friday.
→ browser

> Send a calendar invite for dinner Friday 9pm to john@email.com.
→ `node $OPENCLAW_STATE_DIR/workspace/skills/agentmail/scripts/send-calendar-email.mjs ...`

> Send me an email with today's summary.
→ `node $OPENCLAW_STATE_DIR/workspace/skills/agentmail/scripts/send-email.mjs ...`
_Note: ANY request to send, forward, or reply to email MUST use agentmail scripts. Never respond with a link or suggestion._

> Check my inbox for new emails.
→ `node $OPENCLAW_STATE_DIR/workspace/skills/agentmail/scripts/poll-inbox.mjs ...`

> Text +1555123456 that I'm running late.
→ `telnyx message send --from $TELNYX_PHONE_NUMBER --to +1555123456 --text "..."`
_Note: ANY request to send an SMS/text MUST use telnyx CLI. Always use $TELNYX_PHONE_NUMBER as --from. US numbers (+1) only — if the number is international, decline and suggest email._

> Send an SMS to my wife saying I'll be home at 8.
→ `telnyx message send ...`

> What's my ETH balance?
→ `bankr prompt "What is my ETH balance?"`
_Note: ANY crypto question (balance, price, trade, transfer, portfolio) MUST use bankr CLI._

> Buy $20 of PEPE on Base.
→ `bankr prompt "Buy $20 of PEPE on Base"`

> Send 0.5 ETH to vitalik.eth.
→ `bankr prompt "Send 0.5 ETH to vitalik.eth"`

> What tokens are trending?
→ `bankr prompt "What tokens are trending?"`

> Book in Farid restaurant.
→ web_search → browser
_Note: Multi-step — search finds the page, browser does the booking._

> Reserve at that place and send me an invite.
→ browser → agentmail scripts

> Book a table and text my friend the details.
→ browser → telnyx CLI

> Buy some ETH and email me the confirmation.
→ bankr CLI → agentmail scripts

## Common mistakes

| Prompt | Wrong | Right | Why |
|---|---|---|---|
| "Latest news on X" | browser | web_search | Search, not site interaction |
| "Book a table" | web_search | browser | Booking needs form interaction |
| "Send invite" | browser | agentmail | Email delivery, not browsing |
| "Send me an email" | answer with text | agentmail | Must execute, not suggest |
| "Text my friend" | answer with text | telnyx CLI | Must send SMS via telnyx CLI |
| "What's my balance?" | answer from memory | bankr CLI | Must query live data |
| "Buy ETH" | web_search | bankr CLI | Trading goes through bankr CLI |
| "Text +5411..." | telnyx CLI | decline → suggest email | SMS is US-only (+1 numbers) |
| "Hi" / "What's 2+2" | web_search | No tools | Answer directly |
