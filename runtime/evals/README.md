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

```sh
cd runtime/openclaw && pnpm start   # terminal 1: start the openclaw runtime

cd runtime                          # terminal 2: run evals
pnpm evals              # run all suites (openclaw, the default)
pnpm evals:knows        # knowledge only
pnpm evals:skills       # services only
pnpm evals:soul         # personality only
pnpm evals:convos       # XMTP lifecycle only
pnpm evals:async        # non-blocking only
```

Any runtime is supported via `EVAL_RUNTIME`:

```sh
pnpm evals:hermes              # all suites against hermes
pnpm evals:hermes:knows        # knowledge only
pnpm evals:hermes:skills       # services only
pnpm evals:hermes:soul         # personality only
pnpm evals:hermes:convos       # XMTP lifecycle only
pnpm evals:hermes:async        # non-blocking only
```

Filter to a single test:

```sh
pnpm evals:skills -- --filter-pattern "browse"
pnpm evals:hermes:skills -- --filter-pattern "browse"
pnpm evals:convos -- --filter-pattern "welcome"
```

## Env vars

Required in `runtime/.env` (shared by all runtimes):

- `OPENCLAW_GATEWAY_TOKEN` — must be set explicitly; hermes auto-generates one if missing, but the eval runner needs to know it
- `OPENROUTER_API_KEY` (or `EVAL_OPENROUTER_API_KEY`)
- `AGENTMAIL_API_KEY`
- `TELNYX_API_KEY`
- `BANKR_API_KEY`

## Multi-runtime architecture

The eval suite supports multiple runtimes via an adapter pattern. Each runtime provides a thin adapter (`adapters/<name>.mjs`) that defines how to invoke the CLI, which health endpoint to probe, and how to filter output. Providers import the adapter via `runtime.mjs` and are completely runtime-agnostic.

To add a new runtime:

1. Create `evals/adapters/<name>.mjs` — see `hermes.mjs` for a real example:

```js
export default {
  name: '<name>',
  bin: '<cli-binary>',                                       // e.g. 'hermes', 'openclaw'
  args: (prompt, session) => ['<subcommand>', prompt, ...],  // CLI args to send a prompt
  defaultPort: '8080',                                       // fallback when PORT env is unset
  healthPath: '/health',                                     // gateway health endpoint
  filterLines: (lines) => lines,                             // strip runtime-specific output noise
  needsSessionClear: false,                                  // true if file-based sessions need clearing
  convosPath: '../../runtime-<name>/node_modules/.bin/convos', // path to convos-cli relative to evals/
};
```

2. Add a case in `evals/adapters/env.sh` to source the runtime's `.env` and validate required vars.

3. Add npm scripts in `package.json` (all 6):

```json
"evals:<name>": "EVAL_RUNTIME=<name> sh evals/run.sh",
"evals:<name>:knows": "EVAL_RUNTIME=<name> sh evals/run-suite.sh knows.yaml",
"evals:<name>:skills": "EVAL_RUNTIME=<name> sh evals/run-suite.sh skills.yaml",
"evals:<name>:soul": "EVAL_RUNTIME=<name> sh evals/run-suite.sh soul.yaml",
"evals:<name>:convos": "EVAL_RUNTIME=<name> sh evals/run-suite.sh convos.yaml",
"evals:<name>:async": "EVAL_RUNTIME=<name> sh evals/run-suite.sh async.yaml",
```

## Files

```
evals/
├── knows.yaml             # knowledge suite config
├── skills.yaml            # services suite config
├── soul.yaml              # personality & values suite config
├── convos.yaml            # XMTP lifecycle suite config
├── async.yaml             # non-blocking suite config
├── prompt.provider.mjs    # provider: stateless prompt (parallel)
├── convos.provider.mjs    # provider: XMTP conversation lifecycle
├── async.provider.mjs     # provider: background + foreground concurrency test
├── assertions.mjs         # JS assertions (profile, self-destruct, response time)
├── runtime.mjs            # loads the active runtime adapter
├── utils.mjs              # shared helpers (cleanOutput, session clearing, etc.)
├── adapters/
│   ├── openclaw.mjs       # runtime adapter: openclaw
│   ├── hermes.mjs         # runtime adapter: hermes
│   └── env.sh             # shared env setup (sources .env per runtime)
├── run.sh                 # entry point (runs all suites, any runtime)
├── run-suite.sh           # single-suite entry point (any runtime)
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
