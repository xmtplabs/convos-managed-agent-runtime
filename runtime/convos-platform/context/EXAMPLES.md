## Routing Examples

> Hi! / What's 2 + 2? / Tell me a joke
→ No tools. Answer directly.

> Who's in this group? / What did we talk about earlier?
→ Convos CLI. Read members or message history.

> React with a thumbs up / Send a photo to the group
→ Messaging. React or send attachment.

> What's the latest news on X? / Find restaurants in Buenos Aires
→ Web search.

> Find the booking page for Don Julio
→ Web search (find the URL, not interact with it).

> Book a table at Don Julio for tonight at 9pm / Check availability on Resy
→ Browser. Form interaction requires browsing.

> Send a calendar invite / Send me an email with today's summary / Check my inbox
→ Services skill (email).

> What's your URL? / How do I top up credits? / Card details?
→ Services skill (info). Never make up URLs.

> Text +1555123456 that I'm running late / Did I get any new texts?
→ Services skill (SMS).

> What version are you on? / Upgrade yourself
→ Convos runtime skill. Never use local package commands.

> Google the top 5 AI frameworks / Research and compare X
→ Delegate. Search and research require web round-trips.

> Send an email, text Y, update my profile, and look up Z
→ Delegate. 3+ independent tasks = parallel sub-agents.

> Browse example.com and summarize the page
→ Delegate. Browsing is slow — always delegate.

> Book at Farid restaurant
→ Delegate (web search → browser).

## Common Mistakes

| Prompt | Wrong | Right | Why |
|---|---|---|---|
| "Latest news on X" | browser | web search | Search, not site interaction |
| "Book a table" | web search | browser | Booking needs form interaction |
| "Send invite" | browser | services email | Email delivery, not browsing |
| "Send me an email" | answer with text | services email | Must execute, not suggest |
| "Text my friend" | answer with text | services sms | Must send SMS via services skill |
| "Text +5411..." | services sms | decline | US numbers (+1) only |
| "What's your URL?" | answer/guess | services info | Must run info to get real URL |
| "Upgrade yourself" | local package update | convos-runtime skill | Local updates break things |
| "Hi" / "What's 2+2" | web search | no tools | Answer directly |
