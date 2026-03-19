# Eval Coverage

| Feature Area | Eval Suite | Tests | OpenClaw | Hermes |
|---|---|---|---|---|
| **Self-knowledge** (time, version, URLs, credits) | `knows` | 9 | Yes | Yes |
| **Email** (send, read, attachments, polling) | `skills` / `async-poller` | 10 | Yes | Yes |
| **SMS** (send, poll, disclosure) | `skills` / `provision` | 3 | Yes | Yes |
| **Web** (browse, search) | `skills` | 2 | Yes | Yes |
| **Personality** (brevity, empathy, celebration) | `soul` | 11 | Yes | Yes |
| **Privacy & guardrails** (no leaks, no exfiltration) | `soul` | 3 | Yes | Yes |
| **Consent model** (confirm before acting) | `soul` / `provision` | 5 | Yes | Yes |
| **Service provisioning** (email/SMS onboarding) | `provision` | 4 | Yes | Yes |
| **Profile management** (name, photo, metadata) | `convos` | 6 | Yes | Yes |
| **Welcome & onboarding** | `lifecycle` | 1 | Yes | Yes |
| **Self-destruct on removal** | `lifecycle` | 1 | Yes | Yes |
| **Memory persistence** (store & recall) | `memory` | 6 | Yes | Yes |
| **Async delegation** (sub-agents) | `async-delegation` | 1 | Yes | Yes |
| **Poller** (email polling & notifications) | `async-poller` | 2 | Yes | Yes |
| **Poller hooks** (custom poll.sh) | `async-poller-hooks` | 2 | Yes | Yes |
| **Silence / non-response** | `silence` | 2 | Yes | Yes |
| **Model switching** | `models` | 4 | Yes | No |
| **Cron jobs** | `async-cron` | 2 | Yes | No |

**13 suites, 59 tests total**

## Gaps (documented but untested)

| Feature | Status |
|---|---|
| Loop guard (stop replying after 3+ back-and-forth) | No eval |
| Heartbeat judgment (proactive nudges) | Minimal |
| Noticing quiet members | No eval |
| Emotional tone matching (fun/frustration) | No eval |
| Error handling & fallbacks | No eval |
| Calendar invite sending | No eval |
