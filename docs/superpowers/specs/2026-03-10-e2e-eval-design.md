# E2E Eval Suite for OpenClaw Runtime

## Overview

Automated end-to-end testing that sends real messages to a running OpenClaw agent via `convos-cli` and evaluates responses using LLM-as-judge (via Promptfoo) plus side-effect verification.

Runs on manual dispatch only (not on every PR) to control LLM costs.

## Architecture

```
GitHub Actions (manual dispatch)
  -> Docker container (runtime already running, smoke tests passed)
  -> `pnpm qa:eval` (runs promptfoo via npx)
    -> provider.mjs: creates conversation, joins runtime, sends messages via convos-cli
    -> promptfoo judge: evaluates agent responses via llm-rubric (Sonnet, separate OpenRouter key)
    -> assertions.mjs: verifies side effects via convos-cli
```

## File Layout

```
runtime/scripts/qa/eval/
  promptfooconfig.yaml   # test suite definition
  provider.mjs           # custom provider: conversation setup + message send/receive via convos-cli
  assertions.mjs         # side-effect verification (profile name, image, etc.)
```

New script in `runtime/package.json`:
```
"qa:eval": "npx promptfoo eval -c scripts/qa/eval/promptfooconfig.yaml"
```

No new dependencies — `promptfoo` runs via `npx`.

## Provider (provider.mjs)

Single shared conversation for all tests. Setup on first call:

1. `convos conversations create --name "QA Eval <timestamp>" --env $XMTP_ENV --json` -> get `conversationId` + invite URL (nested as `invite.url` in JSON output)
2. `POST http://localhost:18789/convos/join` with `Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN` and `{ inviteUrl, profileName: "QA Eval Agent" }` -> runtime joins the conversation with a separate agent identity and starts listening
3. Wait briefly for join to propagate

Note: port 18789 is the gateway's internal port (configurable via `GATEWAY_INTERNAL_PORT`). The pool-server on port 8080 proxies to it, but calling the gateway directly is simpler from inside the container.

The `convos-cli` identity (the "user") and the agent identity (created by `/convos/join`) are separate — the agent responds to messages sent by the user.

### Per-test message flow

1. `convos conversation send-text <conversationId> "prompt" --env $XMTP_ENV` -> send message as the user identity
2. Poll `convos conversation messages <conversationId> --sync --limit 5 --direction descending --env $XMTP_ENV --json` until a message appears from a `senderInboxId` different from the user's own `inboxId` (the user's `inboxId` is returned in the `conversations create` output)
3. Return the agent's response text to promptfoo for judging
4. 120s timeout per poll cycle — if no agent response arrives, the test fails

### Image attachment tests

1. `convos conversation send-attachment <conversationId> ./test-image.jpg --env $XMTP_ENV` -> send image as the user
2. Follow with `send-text` for the prompt (e.g. "What do you see in that image?")
3. Poll for agent response as above

### Test image

A small test image (`test-image.jpg`) is stored in `runtime/scripts/qa/eval/` and baked into the Docker image during build. Use a simple, recognizable image (e.g., the XMTP logo) so the judge rubric can verify the agent described it correctly.

### Binary resolution

The `convos` binary resolves from `node_modules/@xmtp/convos-cli/bin/run.js` inside the container (same as existing QA scripts).

## Test Cases

Tests run sequentially in the order listed (promptfoo default). Each test has:
- A prompt sent to the agent via `convos-cli`
- An `llm-rubric` assertion (judge evaluates the response text)
- An optional `javascript` assertion for side-effect verification

### Initial test suite:

| Test | Prompt | Judge rubric | Side-effect check |
|------|--------|-------------|-------------------|
| Update profile name | "Update your profile name to 'QA Bot Alpha'" | Response indicates name was updated | `convos conversation profiles` -> name equals "QA Bot Alpha" |
| Update profile photo | "Update your profile photo to https://xmtp.org/img/logomark-dark.png" | Response indicates photo was updated | `convos conversation profiles` -> image is not null |
| Recognize image | send-attachment test-image.jpg + "What do you see in that image?" | Response describes specific visual content from the image | None (response-only) |
| Tell time | "What time is it right now?" | Response contains a specific time in hours and minutes | None (response-only) |
| See group members | "Who is in this conversation?" | Response lists participants or addresses | None (response-only) |

### promptfooconfig.yaml structure:

```yaml
providers:
  - file://provider.mjs

defaultTest:
  options:
    provider:
      id: openrouter:anthropic/claude-sonnet-4
      config:
        apiKey: "{{EVAL_OPENROUTER_API_KEY}}"

tests:
  - description: "Agent can update profile name"
    vars:
      prompt: "Update your profile name to 'QA Bot Alpha'"
    assert:
      - type: llm-rubric
        value: "The response indicates the profile name was successfully updated"
      - type: javascript
        value: "file://assertions.mjs:profileNameEquals('QA Bot Alpha')"

  - description: "Agent can update profile photo"
    vars:
      prompt: "Update your profile photo to https://xmtp.org/img/logomark-dark.png"
    assert:
      - type: llm-rubric
        value: "The response indicates the profile photo was successfully updated"
      - type: javascript
        value: "file://assertions.mjs:profileImageSet()"

  - description: "Agent can recognize image content"
    vars:
      prompt: "What do you see in that image?"
      attachment: "./test-image.jpg"
    assert:
      - type: llm-rubric
        value: "The response describes specific visual content from the image, not a generic refusal"

  - description: "Agent can tell the time"
    vars:
      prompt: "What time is it right now?"
    assert:
      - type: llm-rubric
        value: "The response contains a specific time in hours and minutes"

  - description: "Agent can see group members"
    vars:
      prompt: "Who is in this conversation?"
    assert:
      - type: llm-rubric
        value: "The response lists one or more participants or addresses in the conversation"
```

## Assertions (assertions.mjs)

Custom assertion functions that query `convos-cli` to verify real state on the XMTP network:

- `profileNameEquals(expected)` — runs `convos conversation profiles <id> --env $XMTP_ENV --json`, checks for matching name
- `profileImageSet()` — same query, checks that image field is non-null

Each returns `{ pass: boolean, reason: string }` per promptfoo convention. The `conversationId` is available via `context.metadata.conversationId`.

## Judge Configuration

- Model: `openrouter:anthropic/claude-sonnet-4` (fast, good at grading)
- API key: `EVAL_OPENROUTER_API_KEY` (separate from agent's key)
- Evaluation method: `llm-rubric` (promptfoo built-in)

## CI Integration

Triggered via `workflow_dispatch` on `runtime-dispatch.yml`. New input alongside existing `tag` input:

```yaml
inputs:
  run_eval:
    description: 'Run e2e eval suite'
    type: boolean
    default: false
```

New step in the existing `qa` job, after the smoke test step:

```yaml
- name: Run e2e eval
  if: inputs.run_eval
  run: |
    docker exec -e EVAL_OPENROUTER_API_KEY=$EVAL_OPENROUTER_API_KEY \
      qa-runtime timeout 900 pnpm qa:eval
  env:
    EVAL_OPENROUTER_API_KEY: ${{ secrets.EVAL_OPENROUTER_API_KEY }}
```

Note: `docker exec -e` passes the env var into the container (step-level `env:` alone does not).

Total timeout: 900s (5 tests x up to 120s each, plus setup overhead).

Promptfoo exits non-zero on any test failure. Default terminal output shows pass/fail table.

## Secrets Required

| Secret | Purpose | New? |
|--------|---------|------|
| `OPENROUTER_API_KEY` | Agent LLM calls | Existing |
| `OPENCLAW_GATEWAY_TOKEN` | Gateway auth for `/convos/join` | Existing |
| `EVAL_OPENROUTER_API_KEY` | Judge LLM calls | **New** |

## No Teardown Needed

Each eval run creates a new conversation. No cleanup required — orphaned QA conversations are harmless.
