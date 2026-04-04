---
title: "TOOLS — SUPERPOWERS"
summary: "What this agent can do; OpenClaw tools implementation"
read_when:
  - Bootstrapping a workspace manually
---

# TOOLS

Primary channel: **Convos** (group chats and DMs for bookings). Full access: all tools are available.

- **FS** — read, write, edit, apply_patch
  - _`read` requires a `path` parameter (absolute path to the file). Never call `read({})` — always pass `read({ path: "/absolute/path" })`._
  - _Images: To view an image, use `read` on the file path. It returns the image inline as base64 so you can see it directly. Do NOT use the `image` tool — no media-understanding provider is configured and it will fail._
- **Browser** — Managed Chrome (profile `openclaw`). Use with profile `openclaw`; start via the tool if needed. Never ask the user to attach the extension or open a tab.
  - _Headless/cloud (Railway): use `target: "host"`; for `navigate` always pass `targetUrl` with the full URL; for other actions pass all required params (e.g. `ref` for `act`)._
- **Web Search** — You have `web_search` and `web_fetch` directly.
- **Cron** — Schedule jobs and wakeups. See CUSTOMIZATION.md for when to use wake-up vs delivery crons.
  - _Cron jobs have no end time or auto-expiry. They run until explicitly stopped (`cron rm`). If a user asks to "run X for 5 minutes" or "stop at 3pm", explain that cron jobs must be stopped manually — either by the user telling you to stop it, or by you remembering to do it. Do NOT create a second cleanup job to delete the first; that pattern is fragile and fails silently._
  - _Wake-up crons use `--system-event` and run in your main session. Delivery crons use `--session isolated --announce --message` to spawn a short-lived agent whose response goes straight to the chat._
  - _In delivery cron sessions, do NOT use the `message` tool — it will fail with "requires a target". Just return your text directly; `--announce` routes it to the right conversation automatically._
- **Sub-Agents** — Spawn background agents via `sessions_spawn` for parallel or long-running work. They run independently and announce results back. Prefer parallel execution: fire multiple tool calls or sub-agents at once when tasks are independent. Don't narrate each step — just do it and deliver results.
  - _Example: "Research the top 5 AI frameworks and compare them" → one sessions_spawn that does all the searching, fetching, and comparison._
  - _Example: "Send an email, check my SMS, update my profile, and search for X" → four independent actions, spawn one sub-agent per action in parallel._
  - _Example: A 10-item to-do list → split into 3–4 chunks of related items, one sessions_spawn per chunk, all running simultaneously._
  - _Rule of thumb: 3+ independent tasks = spawn sub-agents. A single web search = stay inline._
