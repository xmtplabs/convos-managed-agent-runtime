# Eval Suite

Two [Promptfoo](https://promptfoo.dev) eval suites for the OpenClaw runtime.

| Suite | File | Mode | What it tests |
|-------|------|------|---------------|
| **prompt** | `prompt.yaml` | Parallel (5x) | LLM knowledge, services, tools — each test gets its own session |
| **convos** | `convos.yaml` | Sequential (1x) | XMTP lifecycle — welcome, profile, image, members, self-destruct |

## Running

```sh
cd runtime
pnpm start              # terminal 1: start the runtime

pnpm evals              # run both suites
pnpm evals:prompt       # prompt suite only
pnpm evals:convos       # convos suite only
```

Filter to a single test:

```sh
pnpm evals:prompt -- --filter-pattern "browse"
pnpm evals:prompt -- --filter-pattern "SMS"
pnpm evals:convos -- --filter-pattern "welcome"
```

## Env vars

Required in `runtime/.env`:

- `OPENCLAW_GATEWAY_TOKEN`
- `EVAL_OPENROUTER_API_KEY`
- `AGENTMAIL_API_KEY`
- `TELNYX_API_KEY`
- `BANKR_API_KEY`

## Files

```
evals/
├── prompt.yaml            # prompt suite config
├── prompt.provider.mjs    # provider: openclaw agent -m (stateless)
├── convos.yaml            # convos suite config
├── convos.provider.mjs    # provider: XMTP conversation lifecycle
├── assertions.mjs         # JS assertions (profile name/image, self-destruct)
├── utils.mjs              # shared helpers
├── run.sh                 # entry point (runs both suites)
├── summarize.mjs          # CI summary generation
└── test-image.png         # fixture for image recognition test
```

Naming convention: `{suite}.yaml` + `{suite}.provider.mjs`.

## Adding a test

Add to the `tests` array in the relevant suite yaml:

```yaml
- description: "Agent can do X"
  vars:
    prompt: "Do X and confirm."
  assert:
    - type: icontains
      value: "done"
```

For side-effect checks, add a function in `assertions.mjs`:

```yaml
  assert:
    - type: javascript
      value: "file://assertions.mjs:myCheck"
```

## Assertion gotchas

Promptfoo v0.120 does `new RegExp(value)` directly — **no flag support**. This means:

- `(?i)` inline flags don't work
- `/pattern/i` literal syntax doesn't work

For case-insensitive matching, use `icontains` or character classes:

```yaml
# Good — icontains (preferred for simple substring checks)
- type: icontains
  value: "hello"

# Good — character class for case-insensitive regex
- type: regex
  value: "[Hh]ello|[Ww]orld"

# Bad — these silently fail
- type: regex
  value: "(?i)hello"
- type: regex
  value: "/hello/i"
```

## CI

- **PR builds** — runs after smoke tests (non-blocking)
- **Dispatch builds** — runs alongside QA and publish (non-blocking)
- **One-off** — Actions > "Runtime: Eval" > Run workflow
