# Eval Suite

[Promptfoo](https://promptfoo.dev) eval suites for the Convos runtime (12 suites).

| Suite | File | Mode | What it tests |
|-------|------|------|---------------|
| **knows** | `knows.yaml` | Parallel (5x) | Knowledge — time, version, URLs, credits |
| **skills** | `skills.yaml` | Parallel (5x) | Services — email, SMS, browse, search |
| **soul** | `soul.yaml` | Parallel (5x) | Personality & values — brevity, privacy, empathy, identity |
| **provision** | `provision.yaml` | Parallel (5x) | Provisioning protocol — check-first, ask-consent, SMS disclosure |
| **convos** | `convos.yaml` | Sequential (1x) | Convos capabilities — profile updates, vision, group awareness |
| **lifecycle** | `lifecycle.yaml` | Sequential (1x) | XMTP lifecycle — join, welcome message, self-destruct |
| **silence** | `silence.yaml` | Sequential (1x) | Silence — agent stays quiet when it should (heartbeat, explicit) |
| **memory** | `memory.yaml` | Sequential (1x) | Persistent memory across sessions |
| **models** | `models.yaml` | Sequential (1x) | Model awareness — identify, list, and switch models |
| **delegation** | `delegation.yaml` | Sequential (1x) | Non-blocking — agent delegates heavy tasks and stays responsive |
| **cron** | `cron.yaml` | Sequential (1x) | Cron jobs — create, receive pings, delete via Convos |
| **webhooks** | `webhooks.yaml` | Sequential (1x) | Webhook notifications — email and SMS delivered via /convos/notify |

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
│   ├── provision.yaml
│   ├── convos.yaml
│   ├── lifecycle.yaml
│   ├── silence.yaml
│   ├── memory.yaml
│   ├── models.yaml
│   ├── delegation.yaml
│   ├── cron.yaml
│   └── webhooks.yaml
├── providers/
│   ├── prompt.provider.mjs
│   ├── convos.provider.mjs
│   ├── async.provider.mjs
│   ├── memory.provider.mjs
│   └── webhook.provider.mjs
├── lib/
│   ├── assertions.mjs
│   ├── convos-harness.mjs # shared XMTP conversation harness
│   ├── runtime.mjs        # loads the active runtime adapter
│   ├── summarize.mjs      # CI summary generation
│   └── utils.mjs
├── adapters/
│   ├── openclaw.mjs        # baseline adapter
│   ├── hermes.mjs          # hermes adapter (see comparison table inside)
│   └── env.sh              # shared env setup per runtime
└── fixtures/
    └── test-image.png
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

- **PR builds** — `runtime-pr.yml` (calls `runtime-pipeline.yml` per runtime)
- **Dispatch builds** — `runtime-dispatch.yml`
- **One-off** — Actions > "Runtime: Eval" > Run workflow

All 12 suites auto-discover from `suites/*.yaml` — no matrix config needed.

# Eval Coverage

| Feature Area | Eval Suite | Tests | OpenClaw | Hermes |
|---|---|---|---|---|
| **Self-knowledge** (time, version, URLs, credits) | `knows` | 9 | Strong | Strong |
| **Email** (send, read, attachments) | `skills` | 8 | Weak | Weak |
| **SMS** (send, disclosure) | `skills` / `provision` | 3 | Weak | Weak |
| **Web** (browse, search) | `skills` | 2 | Weak | Weak |
| **Personality** (brevity, empathy, celebration) | `soul` | 11 | Strong | Strong |
| **Privacy & guardrails** (no leaks, no exfiltration) | `soul` | 3 | Strong | Strong |
| **Consent model** (confirm before acting) | `soul` / `provision` | 5 | Strong | Strong |
| **Service provisioning** (email/SMS onboarding) | `provision` | 4 | Strong | Strong |
| **Profile management** (name, photo, metadata) | `convos` | 6 | Medium | Medium |
| **Welcome & onboarding** | `lifecycle` | 1 | Strong | Strong |
| **Self-destruct on removal** | `lifecycle` | 1 | Strong | Strong |
| **Memory persistence** (store & recall) | `memory` | 6 | Strong | Strong |
| **Async delegation** (sub-agents) | `delegation` | 1 | Strong | Strong |
| **Webhook notifications** (email/SMS push) | `webhooks` | 3 | Strong | Strong |
| **Silence / non-response** | `silence` | 2 | Strong | Strong |
| **Model switching** | `models` | 4 | Medium | — |
| **Cron jobs** | `cron` | 2 | Medium | — |

**12 suites, 57 tests total**

## Gaps (documented but untested)

| Feature | Status |
|---|---|
| Loop guard (stop replying after 3+ back-and-forth) | No eval |
| Heartbeat judgment (proactive nudges) | Minimal |
| Noticing quiet members | No eval |
| Emotional tone matching (fun/frustration) | No eval |
| Error handling & fallbacks | No eval |
