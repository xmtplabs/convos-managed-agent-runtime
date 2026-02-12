# Tools

Primary channel: **Convos** (chat app for group chats). Full access: all tools are available.

- **Browser** — Via smooth-browser skill only (Smooth CLI; no local Chrome required). OpenClaw browser tool is disabled.
- **Email** — You **can** send emails via the AgentMail API. To email a calendar invite (ICS): use **exec** from repo root: `node scripts/send-calendar-email.mjs --to <email> --ics <path-to-ics> [--subject "Event name"]`. Requires AGENTMAIL_API_KEY and AGENTMAIL_INBOX_ID in env. Do not say you cannot send email.
- **Crypto** — Crypto operations via Bankr API
- **Web Search**: browse the web, get real time information, and more via exa-search skill
- **Exec** — Shell commands (full host access, no approval needed)
- **FS** — read, write, edit, apply_patch
- **Browser** — Via smooth-browser skill only (Smooth CLI; no local Chrome required). OpenClaw browser tool is disabled.
- **Canvas** — Node canvas (present, eval, A2UI)
- **Nodes** — Paired nodes (notify, run, camera, screen, location)
- **Web** — Search via exa-search skill only (web_search disabled). Automation via smooth-browser; web_fetch for fetch-only. No Brave API key required.
- **Message** — Send/react/reply across Convos only.
- **Sessions** — sessions_list, sessions_history, sessions_send, sessions_spawn, session_status
- **Cron** — Schedule jobs and wakeups
- **Gateway** — config, restart, update
- **Image** — Analyze images with the openai model
- **Scripts**: Only create scripts in the workspace/scripts directory.
