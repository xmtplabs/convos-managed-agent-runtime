# Eval Suite

[Promptfoo](https://promptfoo.dev) eval suites for the Convos runtime.

| Suite | File | Mode | What it tests |
|-------|------|------|---------------|
| **knows** | `knows.yaml` | Parallel (5x) | Knowledge — time, version, URLs, credits |
| **skills** | `skills.yaml` | Parallel (5x) | Services — email, SMS, browse, search |
| **soul** | `soul.yaml` | Parallel (5x) | Personality & values — brevity, privacy, empathy, identity |
| **convos** | `convos.yaml` | Sequential (1x) | XMTP lifecycle — welcome, profile, image, members, self-destruct |
| **async** | `async.yaml` | Sequential (1x) | Non-blocking — agent stays responsive during complex tasks |
| **memory** | `memory.yaml` | Sequential (1x) | Persistent memory across sessions |
| **models** | `models.yaml` | Sequential (1x) | Model awareness — identify, list, and switch OpenRouter models |
| **poller** | `poller.yaml` | Sequential (1x) | Email poller pipeline |

## Running

```sh
# Terminal 1: start the runtime
pnpm start              # openclaw
pnpm start:hermes       # hermes

# Terminal 2: run evals (from runtime/)
pnpm evals openclaw             # all suites
pnpm evals openclaw knows       # single suite
pnpm evals hermes memory        # hermes + memory suite
pnpm evals hermes               # hermes + all suites

# Filter to a single test
pnpm evals openclaw skills -- --filter-pattern "browse"
pnpm evals hermes convos -- --filter-pattern "welcome"
```

## Env vars

Required in `runtime/.env` (shared by all runtimes):

- `OPENCLAW_GATEWAY_TOKEN` — must be set explicitly; hermes auto-generates one if missing, but the eval runner needs to know it
- `OPENROUTER_API_KEY` (or `EVAL_OPENROUTER_API_KEY`)
- `AGENTMAIL_API_KEY`
- `TELNYX_API_KEY`
- `BANKR_API_KEY`

## Multi-runtime architecture

The eval suite supports multiple runtimes via an adapter pattern. Each runtime provides a thin adapter (`adapters/<name>.mjs`) that defines how to invoke the agent. Providers import the adapter via `runtime.mjs` and are completely runtime-agnostic.

To add a new runtime:

1. Create `evals/adapters/<name>.mjs` — see `hermes.mjs` for the comparison table vs openclaw (baseline).

2. Add a case in `evals/adapters/env.sh` to source the runtime's `.env` and validate required vars.

## Files

```
evals/
├── eval.sh                # unified entry point: pnpm evals <runtime> [suite]
├── run.sh                 # runs all suites (called by eval.sh)
├── run-suite.sh           # runs one suite (called by eval.sh)
├── suites/
│   ├── knows.yaml
│   ├── skills.yaml
│   ├── soul.yaml
│   ├── convos.yaml
│   ├── async.yaml
│   ├── memory.yaml
│   ├── models.yaml
│   └── poller.yaml
├── providers/
│   ├── prompt.provider.mjs
│   ├── convos.provider.mjs
│   ├── async.provider.mjs
│   ├── memory.provider.mjs
│   └── poller.provider.mjs
├── lib/
│   ├── assertions.mjs
│   ├── runtime.mjs        # loads the active runtime adapter
│   └── utils.mjs
└── adapters/
    ├── openclaw.mjs        # baseline adapter
    ├── hermes.mjs          # hermes adapter (see comparison table inside)
    └── env.sh              # shared env setup per runtime
```

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

## CI

All suites run as parallel matrix jobs in PR and dispatch workflows:

- **PR builds** — `runtime-pr.yml`, `runtime-hermes-pr.yml`
- **Dispatch builds** — `runtime-dispatch.yml`
- **One-off** — Actions > "Runtime: Eval" > Run workflow
