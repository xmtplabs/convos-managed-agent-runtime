# 🎈 Convos runtime changelog

## 0.0.18
- Prompt-based QA: new `qa-prompts.sh` script sends real prompts to the agent and prints responses for manual review
- QA polling: `qa.sh` now checks latest received email, latest inbound SMS, and OpenRouter credit balance
- Email poll: human-readable output by default (use `--json` for raw), filters to received messages only
- Services dashboard: added credit card section
- Removed `/web-tools/form` test page and all references
- OpenRouter credits check: QA shows remaining balance inline

## 0.0.17+
- Unified services skill: replaced separate agentmail and telnyx-cli skills with a single `services` skill — one dispatcher (`services.mjs`) for email, SMS, credits, and identity
- Provider-agnostic: agent no longer sees provider names (AgentMail, Telnyx) — just "email", "phone", "credits"
- Services dashboard: new `/web-tools/services` page showing the agent's email, phone number, and credit balance
- Identity command: `services.mjs identity` returns the agent's contact info and public services page URL
- Credits self-service: agents can check their balance and request top-ups (capped at $100) via the pool server
- No more SDK symlinks: email handler rewritten to use AgentMail REST API directly via fetch — removed agentmail SDK dependency and symlink hack from install-deps.sh
- Removed `agentmail` and `@telnyx/api-cli` npm dependencies — all service integrations now use REST APIs
- Renamed web-tools/agents to web-tools/convos
- QA script updated to test through the unified services skill

## 0.0.17
- State persistence: agent state directory (`OPENCLAW_STATE_DIR`) now derived from Railway volume mount, so identity and state survive restarts
- TOOLS.md: clarified SMS and email skill descriptions to "send and poll" so the agent no longer misinterprets its own capabilities

## 0.0.16
- Health endpoint: runtime now reports its version via `/pool/health`, visible in the dashboard

## 0.0.15
- Credit exhaustion: agent replies with a friendly message when out of credits (402/403) instead of failing silently
- Convos CLI: agent can no longer run unsupported CLI commands (e.g. renaming groups)
- TOOLS.md: simplified skill descriptions, corrected SMS to US-only numbers

## 0.0.14
- Bump `@bankr/cli` to `0.1.0-beta.18`
- Re-enable Bankr quality checks

## 0.0.13
- Fix email inbox polling (`agentmail poll-inbox` arg)

## 0.0.12
- SMS: inbound message support, US-only numbers
- Greeting: agents now greet automatically when joining a conversation
- Improved greeting prompt to highlight real-world capabilities

## 0.0.11
- Agent greeting on join
- Voice calls: inbound call support via Telnyx
- Bump `@xmtp/convos-cli` to 0.3.2
- Self-destruct: agents can shut themselves down when no longer needed
- Loop guard: prevents agents from getting stuck replying to themselves
- Friendly reply when agent runs out of credits
- Fix `CONVOS_ENV` so agents use the correct network

---

> **Style guide:** Agent capabilities only — no workflow, CI, or infra changes. Each entry should name the feature or package, then briefly explain what it does. Keep technical detail (package names, flags) but add plain-language context so non-engineers can follow.
