# E2E Eval Suite

Automated end-to-end evaluation using [Promptfoo](https://promptfoo.dev). Creates real XMTP conversations, has the agent join, sends prompts, and evaluates responses with an LLM judge (Claude Sonnet 4 via OpenRouter).

21 tests run sequentially on a **shared conversation**:

- **Core** (11 tests) — XMTP behavior, profile updates, image recognition, runtime/upgrade awareness, self-destruct
- **Services** (10 tests) — email, SMS, payments, browser, search, knowledge

## Running locally

```sh
cd runtime
pnpm start          # terminal 1: start the runtime
pnpm qa:eval        # terminal 2: run eval
```

Filter to a single test:

```sh
pnpm qa:eval -- --filter-description "welcome"
```

Requires in `runtime/.env`:
- `OPENCLAW_GATEWAY_TOKEN`
- `EVAL_OPENROUTER_API_KEY`
- `AGENTMAIL_API_KEY` — for email tests
- `TELNYX_API_KEY` — for SMS tests
- `BANKR_API_KEY` — for USDC balance test

To save HTML reports:

```sh
EVAL_OUTPUT=./eval-results.html pnpm qa:eval
```

## How it works

All tests share a single XMTP conversation:

1. **Reset** — calls `/convos/reset` to create a fresh agent identity
2. **Create conversation** — eval identity creates a new group via convos-cli
3. **Join** — spawns `process-join-requests --watch` to accept the agent, then calls `/convos/join`
4. **Health gate** — starts with a welcome message test; if the agent doesn't respond, the eval aborts
5. **Test loop** — for each test: send prompt → wait for agent to settle → return scoped transcript
6. **Judge** — Promptfoo sends the transcript to Claude Sonnet 4 with an LLM rubric
7. **Assertions** — JS assertions query the XMTP network to verify side-effects (profile name, image)
8. **Teardown** — self-destruct test removes agent from group, verifies clean shutdown

## Test cases

| # | Test | Type | What it checks |
|---|------|------|----------------|
| 1 | Welcome message | LLM rubric | Agent sends a greeting after joining |
| 2 | Update profile name | LLM + JS | Agent confirms update; name is set on network |
| 3 | Update profile photo | LLM + JS | Agent confirms update; image is set on network |
| 4 | Image recognition | LLM rubric | Agent describes visual content from an attachment |
| 5 | Tell the time | Regex | Agent responds with a specific time (HH:MM) |
| 6 | Group members | LLM rubric | Agent lists conversation participants |
| 7 | Runtime version | LLM rubric | Agent reports a specific runtime version |
| 8 | "Upgrade yourself" | LLM rubric | Interprets as runtime upgrade, not npm/package update |
| 9 | "Upgrade your runtime" | LLM rubric | Explains a runtime upgrade |
| 10 | "Can you update?" | LLM rubric | Interprets vague request as runtime upgrade |
| 11 | Send email | LLM rubric | Sends an email and confirms delivery |
| 12 | Poll emails | LLM rubric | Retrieves latest received email details |
| 13 | Send SMS | LLM rubric | Sends an SMS and confirms delivery |
| 14 | Poll SMS | LLM rubric | Retrieves latest received SMS details |
| 15 | USDC balance | LLM rubric | Checks and reports USDC balance |
| 16 | Browse webpage | LLM rubric | Browses example.com and describes content |
| 17 | Search BTC price | LLM rubric | Searches and returns a current BTC price |
| 18 | Services page URL | Regex | Knows its services page URL (https://...) |
| 19 | Top up credits | LLM rubric | Explains how to add credits |
| 20 | Card balance | LLM rubric | Directs user to check card balance |
| 21 | Self-destruct | JS assertion | Exits cleanly when removed from group |

## Files

```
evals/
├── eval.sh                    # shell wrapper
├── promptfooconfig.yaml       # all 21 tests
├── provider.mjs               # conversation setup + message flow
├── assertions.mjs             # network-level side-effect checks
├── utils.mjs                  # shared helpers (resolveConvos)
├── summarize-results.mjs      # CI summary generation
├── test-image.png             # fixture for image recognition test
└── README.md
```

## Adding a new test

Add a new entry to the `tests` array in `promptfooconfig.yaml` (before the self-destruct test):

```yaml
- description: "Agent can do X"
  vars:
    prompt: "Do X and confirm."
  assert:
    - type: llm-rubric
      value: >
        The USER asked the agent to do X.
        Pass if the AGENT confirmed X was done.
```

For side-effect verification, add a JS assertion in `assertions.mjs` and reference it:

```yaml
    - type: javascript
      value: "file://assertions.mjs:myCustomCheck"
```

## CI

Three ways to run eval in CI:

- **On every PR** that touches `runtime/`. Runs after smoke tests (non-blocking). GitHub shows an inline failure summary plus uploads HTML and JSON artifacts.
- **On dispatch build**: eval runs non-blocking alongside QA and publish in `runtime-dispatch.yml`. Failures don't block the release.
- **One-off dispatch**: trigger the "Runtime: Eval" workflow from any branch (Actions → Runtime: Eval → Run workflow). Runs eval directly from that branch checkout, does **not** build or publish an image, and fails the workflow if eval fails after uploading artifacts and the summary.

Required CI secret: `EVAL_OPENROUTER_API_KEY`
