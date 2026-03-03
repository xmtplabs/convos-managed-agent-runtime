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
- **Composio MCP** — Email (AgentMail) and SMS (Telnyx) tools are available via the Composio MCP server. Use these MCP tools directly for sending/receiving email and SMS. They appear as regular tools in your tool list.

# SKILLS

- **Convos (convos-cli)** — Your conversation. Send messages, replies, reactions, attachments; read members, profiles, history. See `skills/convos-cli/SKILL.md`.
- **Services** — Identity and credits. Use `services.mjs identity` for your URL/email/phone info, and `services.mjs credits` for balance. For sending email and SMS, prefer the Composio MCP tools (they appear in your tool list). The `services.mjs email` and `services.mjs sms` commands are kept as fallback.
- **Crypto (Bankr)** — Trade, transfer, check balances, deploy tokens, manage portfolio. MUST use for ANY crypto/DeFi task. See `skills/bankr/SKILL.md`.



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
**Skill:** Convos (convos-cli)
→ `convos-cli members`
_Note: Use convos-cli to list the members of the current conversation._

> What did we talk about earlier today?
**Skill:** Convos (convos-cli)
→ `convos-cli history`

> React with a thumbs up to the last message.
**Skill:** Convos (convos-cli)
→ `convos-cli react`

> Send a photo of the receipt to the group.
**Skill:** Convos (convos-cli)
→ `convos-cli send` with attachment
_Note: Use convos-cli for sending messages and attachments in the current conversation._

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
**Tool:** Composio MCP (email)

> Send me an email with today's summary.
**Tool:** Composio MCP (email)

> Browse https://example.com and tell me what the page says.
**Tool:** Browser
→ browser

> Check my inbox for new emails.
**Tool:** Composio MCP (email)

> What's your URL? / Share your link / What are your services?
**Skill:** Services (identity)
_Note: Run `services.mjs identity` and share the `servicesUrl` from the result. Never make up a URL._

> How do I top up credits? / Where can I see my balance? / Card details?
**Skill:** Services (identity)
_Note: Run `services.mjs identity` and share the `servicesUrl`. The services landing page is where users manage credits, card, and account status._

> Text +1555123456 that I'm running late.
**Tool:** Composio MCP (SMS)
_Note: US numbers (+1) only._

> Send an SMS to my wife saying I'll be home at 8.
**Tool:** Composio MCP (SMS)

> Did I get any new texts?
**Tool:** Composio MCP (SMS)
_Note: Poll inbound SMS messages._

> What's my ETH balance?
**Skill:** Crypto (Bankr)

> Buy $20 of PEPE on Base.
**Skill:** Crypto (Bankr)

> Send 0.5 ETH to vitalik.eth.
**Skill:** Crypto (Bankr)

> What tokens are trending?
**Skill:** Crypto (Bankr)

> Book in Farid restaurant.
**Tools:** Web Search → Browser

> Reserve at that place and send me an invite.
**Tools:** Browser → Composio MCP (email)

> Book a table and text my friend the details.
**Tools:** Browser → Composio MCP (SMS)

> Buy some ETH and email me the confirmation.
**Tools:** Crypto (Bankr) → Composio MCP (email)

## Common mistakes

| Prompt | Wrong | Right | Why |
|---|---|---|---|
| "Latest news on X" | browser | web_search | Search, not site interaction |
| "Book a table" | web_search | browser | Booking needs form interaction |
| "Send invite" | browser | Composio MCP email | Email delivery, not browsing |
| "Send me an email" | answer with text | Composio MCP email | Must execute, not suggest |
| "Text my friend" | answer with text | Composio MCP sms | Must send SMS via MCP tool |
| "What's my balance?" | answer from memory | bankr CLI | Must query live data |
| "Buy ETH" | web_search | bankr CLI | Trading goes through bankr CLI |
| "Text +5411..." | services sms | decline | US numbers (+1) only |
| "What's your URL?" | answer/guess | services identity | Must run identity to get real URL |
| "Hi" / "What's 2+2" | web_search | No tools | Answer directly |
