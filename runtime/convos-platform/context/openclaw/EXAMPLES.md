
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
_Note: Check inbound SMS messages._

> What version are you on? / What's your runtime?
**Skill:** Convos Runtime
→ `convos-runtime.mjs version`
_Note: Always use the convos-runtime skill. Never guess or check openclaw version._

> Upgrade yourself / Update your runtime
**Skill:** Convos Runtime
→ `convos-runtime.mjs upgrade`
_Note: This hits the pool server to redeploy. NEVER run `gateway update` or `npm update`._


> Google the top 5 AI frameworks released this year.
**Tool:** Sub-Agents
→ Acknowledge, then `sessions_spawn`. "Google …" / "Search for …" / "Look up …" = always delegate.
_Note: Any prompt that asks you to search or Google something requires web round-trips — delegate it._

> Research the top 5 AI frameworks released this year and compare them.
**Tool:** Sub-Agents
→ Acknowledge, then `sessions_spawn` with the full research task. Sub-agent searches, fetches, compares, and announces results.
_Note: Multi-step research = always delegate. Never do 5+ web searches inline._

> Send an email to X, text Y, update my profile photo, and look up Z.
**Tool:** Sub-Agents
→ Acknowledge, then spawn one sub-agent per independent action (4 in parallel). Announce consolidated results.
_Note: 3+ independent tasks = split into parallel sub-agents._

> Here's my to-do list: [10 items]
**Tool:** Sub-Agents
→ Acknowledge, chunk into 3–4 groups of related items, one sessions_spawn per group, announce when all complete.

> Browse https://example.com and summarize the page.
**Tool:** Sub-Agents
→ Acknowledge, then `sessions_spawn` — browsing is slow (page load, rendering, extraction). Sub-agent browses and announces the summary.
_Note: Browser tasks always take multiple seconds. Default to delegating any browsing request._

> Book in Farid restaurant.
**Tools:** Sub-Agents (Web Search → Browser)

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
| "What's in this image?" | `image` tool | `read` on the file path | No media-understanding provider; `read` embeds images inline |
| "Hi" / "What's 2+2" | web_search | No tools | Answer directly |
