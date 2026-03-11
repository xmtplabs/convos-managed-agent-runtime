# QA — E2E Eval Suite

Automated end-to-end evaluation using [Promptfoo](https://promptfoo.dev). Creates real XMTP conversations, has the agent join, sends prompts, and evaluates responses with an LLM judge (Claude Sonnet 4 via OpenRouter).

Tests are split into two suites that run sequentially on a **shared conversation**:

- **Core** (11 tests) — XMTP behavior, profile updates, image recognition, runtime/upgrade awareness, self-destruct
- **Services** (10 tests) — email, SMS, payments, browser, search, knowledge

Core runs first (resets identity, creates conversation, joins agent). Services reuses the same conversation — no extra setup time.

## Running locally

```sh
cd runtime
pnpm start          # terminal 1: start the runtime
pnpm qa:eval          # terminal 2: run both suites in parallel
```

Run a single suite:

```sh
pnpm qa:eval -- --suite=core
pnpm qa:eval -- --suite=services
```

Filter to a single test within a suite:

```sh
EVAL_SUITE=core pnpm qa:eval -- --suite=core --filter-description "welcome"
```

Requires in `runtime/.env`:
- `OPENCLAW_GATEWAY_TOKEN`
- `EVAL_OPENROUTER_API_KEY`
- `AGENTMAIL_API_KEY` — for email tests
- `TELNYX_API_KEY` — for SMS tests
- `BANKR_API_KEY` — for USDC balance test

To save HTML reports (one per suite):

```sh
EVAL_OUTPUT=./eval-results.html pnpm qa:eval
# produces eval-results-core.html and eval-results-services.html
```

## How it works

Both suites share a single XMTP conversation:

1. **Reset** — core suite calls `/convos/reset` to create a fresh agent identity
2. **Create conversation** — eval identity creates a new group via convos-cli
3. **Join** — spawns `process-join-requests --watch` to accept the agent, then calls `/convos/join`
4. **Health gate** — core starts with a welcome message test; if the agent doesn't respond, the eval aborts immediately
5. **Handoff** — after core finishes, services reuses the same conversation (no setup overhead)
5. **Test loop** — for each test case: send prompt → wait for agent to settle → return full transcript
6. **Judge** — Promptfoo sends the transcript to Claude Sonnet 4 with an LLM rubric
7. **Assertions** — JS assertions query the XMTP network to verify side-effects (profile name, image)

## Test cases

### Core suite (`core.yaml`)

| Test | Assertion | What it checks |
|------|-----------|----------------|
| Welcome message | LLM rubric | Agent sends a greeting after joining |
| Update profile name | LLM rubric + JS | Agent confirms update; name is set on network |
| Update profile photo | LLM rubric + JS | Agent confirms update; image is set on network |
| Image recognition | LLM rubric | Agent describes visual content from an attachment |
| Tell the time | LLM rubric | Agent responds with a specific time |
| Group members | LLM rubric | Agent lists conversation participants |
| Runtime version | LLM rubric | Agent reports a specific runtime version |
| "Upgrade yourself" | LLM rubric | Agent interprets as runtime upgrade, not npm/package update |
| "Upgrade your runtime" | LLM rubric | Agent explains a runtime upgrade |
| "Can you update?" | LLM rubric | Agent interprets vague request as runtime upgrade |
| Self-destruct | JS assertion | Agent exits cleanly when removed from group |

### Services suite (`services.yaml`)

| Test | Assertion | What it checks |
|------|-----------|----------------|
| Send email | LLM rubric | Agent sends an email and confirms delivery |
| Poll emails | LLM rubric | Agent retrieves latest received email details |
| Send SMS | LLM rubric | Agent sends an SMS and confirms delivery |
| Poll SMS | LLM rubric | Agent retrieves latest received SMS details |
| USDC balance | LLM rubric | Agent checks and reports USDC balance |
| Browse webpage | LLM rubric | Agent browses example.com and describes its content |
| Search BTC price | LLM rubric | Agent searches and returns a current BTC price |
| Services page URL | LLM rubric | Agent knows its services page URL |
| Top up credits | LLM rubric | Agent explains how to add credits |
| Card balance | LLM rubric | Agent directs user to check card balance |

## Smoke tests

Smoke tests (`pnpm qa`) run separately and verify that individual tools work at the CLI level — no agent session, no XMTP conversation. They check plumbing (email send/poll, SMS send/poll, convos-cli, browser, credits) with simple grep-based pass/fail. The eval suite above covers the same capabilities end-to-end through the agent.

## Files

```
scripts/qa/
├── smoke.sh                   # smoke tests (CLI-level tool checks)
├── eval.sh                    # eval orchestrator (parallel core + services)
└── eval/
    ├── core.yaml              # core suite: XMTP, profile, runtime, self-destruct
    ├── services.yaml          # services suite: email, SMS, browser, search, knowledge
    ├── provider.mjs           # conversation setup + message flow
    ├── assertions.mjs         # network-level side-effect checks
    ├── utils.mjs              # shared helpers (resolveConvos)
    ├── summarize-results.mjs  # CI summary generation
    └── test-image.png         # fixture for image recognition test
```

## Adding a new test

Add a new entry to the `tests` array in the appropriate suite YAML (`core.yaml` or `services.yaml`). In core, add before the self-destruct test:

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

- **On every PR** that touches `runtime/`. Runs after smoke tests (non-blocking). GitHub shows an inline failure summary plus uploads HTML and JSON artifacts.
- **On dispatch build**: eval runs non-blocking alongside QA and publish in `runtime-dispatch.yml`. Failures don't block the release.
- **One-off dispatch**: trigger the "Runtime: Eval" workflow from any branch (Actions → Runtime: Eval → Run workflow). Runs eval directly from that branch checkout, does **not** build or publish an image, and fails the workflow if eval fails after uploading artifacts and the summary.

Required CI secret: `EVAL_OPENROUTER_API_KEY`
