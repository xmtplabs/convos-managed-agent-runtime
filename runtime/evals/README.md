# Eval Suite

Five [Promptfoo](https://promptfoo.dev) eval suites for the Convos runtime.

| Suite | File | Mode | What it tests |
|-------|------|------|---------------|
| **knows** | `knows.yaml` | Parallel (5x) | Knowledge — time, version, URLs, credits |
| **skills** | `skills.yaml` | Parallel (5x) | Services — email, SMS, browse, search |
| **soul** | `soul.yaml` | Parallel (5x) | Personality & values — brevity, privacy, empathy, identity |
| **convos** | `convos.yaml` | Sequential (1x) | XMTP lifecycle — welcome, profile, image, members, self-destruct |
| **async** | `async.yaml` | Sequential (1x) | Non-blocking — agent stays responsive during complex tasks |

## Running

### OpenClaw runtime

```sh
cd runtime
pnpm start              # terminal 1: start the runtime

pnpm evals              # run all suites
pnpm evals:knows        # knowledge only
pnpm evals:skills       # services only
pnpm evals:soul         # personality only
pnpm evals:convos       # XMTP lifecycle only
pnpm evals:async        # non-blocking only
```

### Hermes runtime

The same 5 YAML suites run against Hermes via `EVAL_RUNTIME=hermes`. Providers switch to `hermes chat -q` instead of `openclaw agent -m`.

```sh
cd runtime
# terminal 1: start hermes (in runtime-hermes/)
pnpm evals:hermes              # run all suites against hermes
pnpm evals:hermes:knows        # knowledge only
pnpm evals:hermes:skills       # services only
pnpm evals:hermes:soul         # personality only
pnpm evals:hermes:convos       # XMTP lifecycle only
pnpm evals:hermes:async        # non-blocking only
```

### Filtering

Filter to a single test:

```sh
pnpm evals:skills -- --filter-pattern "browse"
pnpm evals:hermes:skills -- --filter-pattern "browse"
pnpm evals:convos -- --filter-pattern "welcome"
```

## Env vars

Required in `runtime/.env`:

- `OPENCLAW_GATEWAY_TOKEN`
- `EVAL_OPENROUTER_API_KEY` (falls back to `OPENROUTER_API_KEY` if unset)
- `AGENTMAIL_API_KEY`
- `TELNYX_API_KEY`
- `BANKR_API_KEY`

Additional for Hermes (in `runtime-hermes/.env`):

- `OPENCLAW_GATEWAY_TOKEN` (must be set explicitly — hermes auto-generates one otherwise, but the eval runner needs to know it)
- `PORT` (defaults to `8080`)
- `OPENROUTER_API_KEY`

## Files

```
evals/
├── knows.yaml             # knowledge suite config
├── skills.yaml            # services suite config
├── soul.yaml              # personality & values suite config
├── convos.yaml            # XMTP lifecycle suite config
├── async.yaml             # non-blocking suite config
├── prompt.provider.mjs    # provider: openclaw agent -m (stateless, parallel)
├── convos.provider.mjs    # provider: XMTP conversation lifecycle
├── async.provider.mjs     # provider: background + foreground concurrency test
├── assertions.mjs         # JS assertions (profile, self-destruct, response time)
├── utils.mjs              # shared helpers
├── run.sh                 # entry point (runs all suites)
├── run-suite.sh           # single-suite entry point
├── run-hermes.sh          # entry point (runs all suites against hermes)
├── run-hermes-suite.sh    # single-suite entry point for hermes
├── summarize.mjs          # CI summary generation
└── test-image.png         # fixture for image recognition test
```

Naming convention: `{suite}.yaml` + `{suite}.provider.mjs` (if custom provider needed).

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

For personality/behavior checks, use `llm-rubric`:

```yaml
  assert:
    - type: llm-rubric
      value: >
        The agent should respond with empathy.
        Pass if caring. Fail if robotic.
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

All 5 suites run as parallel matrix jobs in PR and dispatch workflows:

- **PR builds** — `runtime-pr.yml` matrix: knows, skills, soul, convos, async
- **Dispatch builds** — `runtime-dispatch.yml` same matrix
- **One-off** — Actions > "Runtime: Eval" > Run workflow (sequential)
