# QA commands

Gateway must be running (`pnpm gateway`). Use `--session-id "qa-<suite>-$(date +%s)"` for isolated runs, or omit for default session.

## Email

```bash
openclaw agent -m "Send a random short email to fabri@xmtp.com. Reply: Email sent." --agent main
```

## SMS

```bash
openclaw agent -m "Send a random short SMS to +16154376139. Reply: SMS sent." --agent main
```

## Bankr

```bash
openclaw agent -m "Check my USDC balance. Reply: USDC: <balance>." --agent main
```

## Search

```bash
openclaw agent -m 'Search the current BTC price. Reply: BTC: $X.' --agent main
```

## Browser

```bash
openclaw agent -m "Browse https://example.com and tell me what the page says." --agent main
```

---

# E2E Eval Suite

Automated end-to-end evaluation using [Promptfoo](https://promptfoo.dev). Creates a real XMTP conversation, has the agent join, sends prompts, and evaluates responses with an LLM judge (Claude Sonnet 4 via OpenRouter).

## Running locally

```sh
cd runtime
pnpm gateway          # start the gateway first
pnpm qa:eval          # run all tests
```

Requires `OPENCLAW_GATEWAY_TOKEN` and `EVAL_OPENROUTER_API_KEY` in `runtime/.env`.

To save an HTML report:

```sh
EVAL_OUTPUT=./eval-results.html pnpm qa:eval
```

## How it works

All tests share a single conversation (sequential execution):

1. **Reset** — calls `/convos/reset` to create a fresh agent identity
2. **Create conversation** — eval identity creates a new group via convos-cli
3. **Join** — spawns `process-join-requests --watch` to accept the agent, then calls `/convos/join`
4. **Test loop** — for each test case: send prompt → wait for agent to settle → return full transcript
5. **Judge** — Promptfoo sends the transcript to Claude Sonnet 4 with an LLM rubric
6. **Assertions** — JS assertions query the XMTP network to verify side-effects (profile name, image)

## Files

```
scripts/qa/eval/
├── promptfooconfig.yaml   # test definitions and judge config
├── provider.mjs           # conversation setup + message flow
├── assertions.mjs         # network-level side-effect checks
├── utils.mjs              # shared helpers (resolveConvos)
└── test-image.png         # fixture for image recognition test
```

## Test cases

| Test | Assertion type | What it checks |
|------|---------------|----------------|
| Welcome message | LLM rubric | Agent sends a greeting after joining |
| Update profile name | LLM rubric + JS | Agent confirms update; name is set on network |
| Update profile photo | LLM rubric + JS | Agent confirms update; image is set on network |
| Image recognition | LLM rubric | Agent describes visual content from an attachment |
| Tell the time | LLM rubric | Agent responds with a specific time |
| Group members | LLM rubric | Agent lists conversation participants |

## Adding a new test

Add a new entry to the `tests` array in `promptfooconfig.yaml`:

```yaml
- description: "Agent can do X"
  vars:
    prompt: "Do X and confirm."
  assert:
    - type: llm-rubric
      value: >
        This is a chat transcript between USER and AGENT. The USER asked
        the agent to do X. Pass if the AGENT's response indicates X was done.
```

For side-effect verification, add a JS assertion in `assertions.mjs` and reference it:

```yaml
    - type: javascript
      value: "file://assertions.mjs:myCustomCheck"
```

## CI

Three ways to run eval in CI:

- **On a PR**: add the `run-eval` label to any PR that touches `runtime/`. The eval runs after smoke tests and the HTML report is uploaded as an artifact.
- **On dispatch build**: eval runs non-blocking alongside QA and publish in `runtime-dispatch.yml`. Failures don't block the release.
- **One-off dispatch**: trigger the "Runtime: Eval" workflow from any branch (Actions → Runtime: Eval → Run workflow). Builds the image but does **not** publish it.

Required secret: `EVAL_OPENROUTER_API_KEY`
