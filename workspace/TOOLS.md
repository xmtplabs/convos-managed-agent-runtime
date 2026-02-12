# Tools

Primary channel: **Convos**. Full access: all tools available.

## Agents

| Agent | Role | Tools |
|-------|------|-------|
| **main** (Concierge) | Default. Handles chat, search, and delegates to sub-agents | `exa-search`, `bankr` |
| **browser** (Web Automation) | Sub-agent for website interaction | `smooth-browser` |
| **email** (Email Agent) | Sub-agent for sending emails/invites | `agentmail` |

## Skills

| Skill | Agent | When to use |
|-------|-------|------------|
| **exa-search** | main | **Default for information needs.** News, research, finding URLs/venues, factual questions, "what is", "find me", "latest news on", any lookup that doesn't require clicking on a website |
| **smooth-browser** | browser | **Only when you need to interact with a website.** Book a table, fill a form, log in, check live availability on a specific site, scrape dynamic content. Never use for simple searches or news |
| **agentmail** | email | Send emails and calendar invites |
| **bankr** | main | Crypto trading, portfolio, DeFi, NFTs, blockchain transactions |

### Routing priority

1. If user wants **information/news/search** → `exa-search` (main handles directly)
2. If user wants to **interact with a site** (book, click, fill) → delegate to **browser** sub-agent
3. If user wants to **send email/invite** → delegate to **email** sub-agent
4. If user mentions **crypto/tokens/DeFi** → `bankr` (main handles directly)
5. When unsure → start with `exa-search`, delegate to **browser** sub-agent only if interaction is needed

## Routing Examples

### Look up latest news
**Prompt:** > What's the latest news on Elon Musk?
**Skills:** `exa-search`

### Find restaurants in a city
**Prompt:** > Find Italian restaurants in Buenos Aires.
**Skills:** `exa-search`

### Find a booking page
**Prompt:** > Find the booking page for Don Julio steakhouse.
**Skills:** `exa-search`
**Note:** This only finds the URL. To actually book, `smooth-browser` takes over.

### Find an exact address
**Prompt:** > Find the exact address for the Farid restaurant.
**Skills:** `exa-search`

### Book a restaurant
**Prompt:** > Book a table at Don Julio for tonight at 9pm.
**Agent:** → **browser** sub-agent (`smooth-browser`)
**Note:** If the user doesn't provide a URL, main runs `exa-search` first to find the booking page, then delegates to **browser**.

### Check live availability
**Prompt:** > Check availability on Resy for 2 people Friday.
**Agent:** → **browser** sub-agent (`smooth-browser`)

### Send a calendar invite
**Prompt:** > Send a calendar invite for dinner Friday 9pm to john@email.com.
**Agent:** → **email** sub-agent (`agentmail`)

### Execute a crypto trade
**Prompt:** > Buy 0.1 ETH on Base.
**Skills:** `bankr`

### Multi-step: search then book
**Prompt:** > Book in Farid restaurant.
**Flow:** main (`exa-search`) → **browser** sub-agent (`smooth-browser`)

### Multi-step: book then notify
**Prompt:** > Reserve at that place and send me an invite.
**Flow:** **browser** sub-agent (`smooth-browser`) → **email** sub-agent (`agentmail`)

### Common mistakes
- "Latest news on X" → ~~browser sub-agent~~ → **main** (`exa-search`) — search, not site interaction.
- "Book a table" → ~~main~~ → **browser** sub-agent (`smooth-browser`) — booking needs form interaction.
- "Send invite" → ~~browser sub-agent~~ → **email** sub-agent (`agentmail`) — email delivery, not browsing.

## Built-in Tools

- **Exec** — Shell commands (full host access)
- **FS** — read, write, edit, apply_patch
- **Canvas** — Node canvas (present, eval, A2UI)
- **Nodes** — Paired nodes (notify, run, camera, screen, location)
- **Message** — Send/react/reply in Convos
- **Sessions** — sessions_list, sessions_history, sessions_send, sessions_spawn, session_status
- **Cron** — Schedule jobs and wakeups
- **Gateway** — config, restart, update
- **Image** — Analyze images

## File locations

- **Scripts**: `workspace/scripts/`
- **Generated artifacts** (ICS files, reports, exports): `workspace/artifacts/`
