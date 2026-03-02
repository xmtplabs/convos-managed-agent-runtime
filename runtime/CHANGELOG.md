# 🎈 Convos runtime changelog

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
