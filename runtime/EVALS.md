# Eval Suite

[Promptfoo](https://promptfoo.dev) eval suites for the Convos runtime (17 suites, 79 tests).

| Suite | File | Mode | What it tests |
|-------|------|------|---------------|
| **brevity** | `brevity.yaml` | Parallel (5x) | Response length — concise answers, no over-explaining |
| **knows** | `knows.yaml` | Parallel (5x) | Knowledge — time, version, URLs, credits |
| **skills** | `skills.yaml` | Parallel (5x) | Services — email, SMS, browse, search |
| **soul** | `soul.yaml` | Parallel (5x) | Personality & values — brevity, privacy, empathy, identity |
| **services** | `services.yaml` | Parallel (5x) | Services page and integration management |
| **convos** | `convos.yaml` | Sequential (1x) | Convos capabilities — profile updates, vision, group awareness |
| **onboarding** | `onboarding.yaml` | Sequential (1x) | Onboarding — greeting + skill-builder discovery flow |
| **skill-builder** | `skill-builder.yaml` | Sequential (1x) | Skill builder — optimistic build: describe → build + activate |
| **lifecycle** | `lifecycle.yaml` | Sequential (1x) | XMTP lifecycle — restart resilience, self-destruct |
| **silence** | `silence.yaml` | Sequential (1x) | Silence — agent stays quiet when it should (heartbeat, explicit) |
| **response-discipline** | `response-discipline.yaml` | Sequential (1x) | Response discipline — silent on acknowledgments, off-topic; responds to direct engagement |
| **memory** | `memory.yaml` | Sequential (1x) | Persistent memory across sessions |
| **models** | `models.yaml` | Sequential (1x) | Model awareness — identify, list, and switch models |
| **delegation** | `delegation.yaml` | Sequential (1x) | Non-blocking — agent delegates heavy tasks and stays responsive |
| **cron** | `cron.yaml` | Sequential (1x) | Cron jobs — create, receive pings, delete via Convos |
| **reasoning** | `reasoning.yaml` | Sequential (1x) | Reasoning suppression — thinking/reasoning text never leaks to user |
| **webhooks** | `webhooks.yaml` | Sequential (1x) | Webhook notifications — email and SMS delivered via /convos/notify |

## Coverage

| Feature Area | Eval Suite | Tests | OpenClaw | Hermes |
|---|---|---|---|---|
| **Self-knowledge** (time, version, URLs, credits) | `knows` | 6 | Strong | Strong |
| **Brevity** (concise, no over-explaining) | `brevity` | 5 | Strong | Strong |
| **Email** (send, read, attachments) | `skills` | 5 | Weak | Weak |
| **SMS** (send, disclosure) | `skills` | — | Weak | Weak |
| **Web** (browse, search) | `skills` | — | Weak | Weak |
| **Personality** (brevity, empathy, celebration) | `soul` | 10 | Strong | Strong |
| **Privacy & guardrails** (no leaks, no exfiltration) | `soul` | — | Strong | Strong |
| **Service provisioning** (integrations page) | `services` | 5 | Strong | Strong |
| **Profile management** (name, photo, metadata) | `convos` | 8 | Medium | Medium |
| **Welcome & onboarding** | `onboarding` | 2 | Strong | Strong |
| **Skill builder** | `skill-builder` | 2 | Strong | Strong |
| **Lifecycle** (restart, self-destruct) | `lifecycle` | 2 | Strong | Strong |
| **Memory persistence** (store & recall) | `memory` | 5 | Strong | Strong |
| **Async delegation** (sub-agents) | `delegation` | 2 | Strong | Strong |
| **Webhook notifications** (email/SMS push) | `webhooks` | 4 | Strong | Strong |
| **Silence / non-response** | `silence` | 4 | Strong | Strong |
| **Response discipline** | `response-discipline` | 9 | Strong | Strong |
| **Model switching** | `models` | 4 | Medium | Medium |
| **Cron jobs** | `cron` | 1 | Medium | Medium |
| **Reasoning suppression** | `reasoning` | 5 | Strong | Strong |

### Gaps (documented but untested)

| Feature | Status |
|---|---|
| Loop guard (stop replying after 3+ back-and-forth) | No eval |
| Heartbeat judgment (proactive nudges) | Minimal |
| Noticing quiet members | No eval |
| Emotional tone matching (fun/frustration) | No eval |
| Error handling & fallbacks | No eval |

## Running

```sh
# Terminal 1: start the runtime
cd openclaw && pnpm start       # openclaw
cd hermes && pnpm start         # hermes

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

- `GATEWAY_TOKEN` — must be set explicitly; hermes auto-generates one if missing, but the eval runner needs to know it
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
│   ├── brevity.yaml
│   ├── convos.yaml
│   ├── cron.yaml
│   ├── delegation.yaml
│   ├── knows.yaml
│   ├── lifecycle.yaml
│   ├── memory.yaml
│   ├── models.yaml
│   ├── onboarding.yaml
│   ├── reasoning.yaml
│   ├── response-discipline.yaml
│   ├── services.yaml
│   ├── silence.yaml
│   ├── skill-builder.yaml
│   ├── skills.yaml
│   ├── soul.yaml
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

All 17 suites auto-discover from `suites/*.yaml` — no matrix config needed.
