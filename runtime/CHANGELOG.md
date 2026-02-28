# Runtime Changelog

## 0.0.14
- Bump `@bankr/cli` to `0.1.0-beta.18`
- Re-enable bankr QA test

## 0.0.13
- Fix agentmail `poll-inbox` positional arg

## 0.0.12
- SMS skill: inbound support, US-only restriction, node scripts refactor
- Refine greeting prompt for real-world capabilities
- Make greeting default behavior (remove `greetOnJoin` config)

## 0.0.11
- Agent greeting on join
- Voice-call plugin with Telnyx inbound call support
- Bump `@xmtp/convos-cli` to 0.3.2
- Agent self-destruct primitive
- Conversation loop guard
- Friendly message on credit exhaustion (402)
- Set `CONVOS_ENV` on gateway for correct network
