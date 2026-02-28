# Runtime Changelog

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
