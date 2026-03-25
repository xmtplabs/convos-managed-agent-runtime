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
