---
title: "TOOLS — SUPERPOWERS"
summary: "What this agent can do; Convos skills and OpenClaw implementation"
read_when:
  - Bootstrapping a workspace manually
---

# TOOLS

Primary channel: **Convos** (group chats and DMs for bookings). Full access: all tools are available.

- **Convos (convos-cli)** — Your conversation. Send messages, replies, reactions, attachments; read members, profiles, history. See `skills/convos-cli/SKILL.md` for the full protocol reference.
- **Exec** — Shell commands (full host access, no approval needed)
- **FS** — read, write, edit, apply_patch
- **Browser** — Managed Chrome (profile `openclaw`). Use with profile `openclaw`; start via the tool if needed. Never ask the user to attach the extension or open a tab.
  - _Headless/cloud (Railway, CHROMIUM_PATH): use `target: "host"`; for `navigate` always pass `targetUrl` with the full URL; for other actions pass all required params (e.g. `ref` for `act`)._
- **Web Search** — You have `web_search` and `web_fetch` directly.
- **Cron** — Schedule jobs and wakeups
- **Email (AgentMail)** — Send and receive emails, calendar invites, poll inbox. MUST use for ANY email task. Run scripts as `node $OPENCLAW_STATE_DIR/workspace/skills/agentmail/scripts/<script>.mjs ...`
- **SMS (Telnyx)** — Send and receive SMS messages. **US numbers only** (+1). If the recipient is outside the US, tell the user SMS is not available for that destination and suggest email instead. MUST use for ANY SMS/text message task. Run via `telnyx message send --from $TELNYX_PHONE_NUMBER --to <number> --text "message"`.
- **Crypto (Bankr)** — Trade, transfer, check balances, deploy tokens, manage portfolio. MUST use for ANY crypto/DeFi task. Run via `bankr prompt "natural language instruction"` or the REST API at `https://api.bankr.bot`.


# Skill Quick Reference

## AgentMail (Email)

```bash
# Send email
node $OPENCLAW_STATE_DIR/workspace/skills/agentmail/scripts/send-email.mjs \
  --to recipient@email.com --subject "Subject" --text "Body"

# Send with HTML and attachment
node $OPENCLAW_STATE_DIR/workspace/skills/agentmail/scripts/send-email.mjs \
  --to recipient@email.com --subject "Subject" --text "Body" --html "<p>HTML</p>" --attach /path/to/file

# Send calendar invite
node $OPENCLAW_STATE_DIR/workspace/skills/agentmail/scripts/send-calendar-email.mjs \
  --to recipient@email.com --ics /path/to/file.ics --subject "Event name"

# Check inbox (new mail + unreplied threads)
node $OPENCLAW_STATE_DIR/workspace/skills/agentmail/scripts/poll-inbox.mjs --limit 20 --labels unread --threads
```

## Telnyx (SMS)

```bash
# Send SMS (always use $TELNYX_PHONE_NUMBER as --from)
telnyx message send --from $TELNYX_PHONE_NUMBER --to +15559876543 --text "Hello!"

# List messages
telnyx message list

# Get message status
telnyx message get MESSAGE_ID

# List your phone numbers
telnyx number list

# Check account balance
telnyx account get
```

## Bankr (Crypto)

```bash
# Check balance
bankr prompt "What is my ETH balance on Base?"

# Check price
bankr prompt "What's the price of Bitcoin?"

# Trade
bankr prompt "Buy $50 of ETH on Base"

# Transfer
bankr prompt "Send 0.1 ETH to vitalik.eth"

# Portfolio
bankr prompt "Show my complete portfolio"

# Automation
bankr prompt "DCA $100 into ETH every week"
```

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
→ exec: `node $OPENCLAW_STATE_DIR/workspace/skills/agentmail/scripts/send-calendar-email.mjs ...`

> Send me an email with today's summary.
→ exec: `node $OPENCLAW_STATE_DIR/workspace/skills/agentmail/scripts/send-email.mjs ...`
_Note: ANY request to send, forward, or reply to email MUST use the exec tool to run agentmail scripts. Never respond with a link or suggestion._

> Check my inbox for new emails.
→ exec: `node $OPENCLAW_STATE_DIR/workspace/skills/agentmail/scripts/poll-inbox.mjs ...`

> Text +1555123456 that I'm running late.
→ exec: `telnyx message send --from $TELNYX_PHONE_NUMBER --to +1555123456 --text "..."`
_Note: ANY request to send an SMS/text MUST use the exec tool to run telnyx CLI. Always use $TELNYX_PHONE_NUMBER as --from. US numbers (+1) only — if the number is international, decline and suggest email._

> Send an SMS to my wife saying I'll be home at 8.
→ exec: `telnyx message send ...`

> What's my ETH balance?
→ exec: `bankr prompt "What is my ETH balance?"`
_Note: ANY crypto question (balance, price, trade, transfer, portfolio) MUST use the exec tool to run bankr CLI._

> Buy $20 of PEPE on Base.
→ exec: `bankr prompt "Buy $20 of PEPE on Base"`

> Send 0.5 ETH to vitalik.eth.
→ exec: `bankr prompt "Send 0.5 ETH to vitalik.eth"`

> What tokens are trending?
→ exec: `bankr prompt "What tokens are trending?"`

> Book in Farid restaurant.
→ web_search → browser
_Note: Multi-step — search finds the page, browser does the booking._

> Reserve at that place and send me an invite.
→ browser → exec (agentmail scripts)

> Book a table and text my friend the details.
→ browser → exec (telnyx CLI)

> Buy some ETH and email me the confirmation.
→ exec (bankr CLI) → exec (agentmail scripts)

## Common mistakes

| Prompt | Wrong | Right | Why |
|---|---|---|---|
| "Latest news on X" | browser | web_search | Search, not site interaction |
| "Book a table" | web_search | browser | Booking needs form interaction |
| "Send invite" | browser | exec (agentmail) | Email delivery, not browsing |
| "Send me an email" | answer with text | exec (agentmail) | Must execute, not suggest |
| "Text my friend" | answer with text | exec (telnyx) | Must send SMS via telnyx CLI |
| "What's my balance?" | answer from memory | exec (bankr) | Must query live data |
| "Buy ETH" | web_search | exec (bankr) | Trading goes through bankr CLI |
| "Text +5411..." | exec (telnyx) | decline → suggest email | SMS is US-only (+1 numbers) |
| "Hi" / "What's 2+2" | web_search | No tools | Answer directly |
