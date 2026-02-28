# Runtime Changelog

## 0.0.14
- Bump `@bankr/cli` to `0.1.0-beta.18`

## 0.0.13
- Fix agentmail `poll-inbox` positional arg
- Disable bankr QA test (too slow for CI)
- Remove auto version-bump from runtime workflow

## 0.0.12
- SMS skill: inbound support, US-only restriction, node scripts refactor
- Refine greeting prompt for real-world capabilities
- Remove `greetOnJoin` config, make greeting default
- Automated runtime versioning

## 0.0.11
- Agent greeting on join
- Voice-call plugin with Telnyx inbound call support
- Bump `@xmtp/convos-cli` to 0.3.2
- Services layer extraction and DB separation
- Agent self-destruct primitive
- Railway sharding (one project per agent)
- Telnyx phone number provisioning per pool instance
- Conversation loop guard guidelines
- GHCR image pool, DB instances, Railway API batching
- Reply with friendly message on credit exhaustion (402)
- Set `CONVOS_ENV` on gateway for correct network
