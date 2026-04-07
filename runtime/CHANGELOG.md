# Changelog

## 0.3.1

### Features
- **dashboard:** Skills landing page improvements (#974)
- **pool:** Auto-replenish instances after claim when below target (#875)
- **openclaw:** Inject AgentName into inbound message context (#960)
- **openclaw:** Full marker parity with Hermes (#953)
- **context:** Add TIME-AWARENESS to INJECTED_CONTEXT (#952)
- **evals:** Add reasoning suppression eval suite (#954)
- **evals:** Add delegation stop/interrupt test (#950)

### Fixes
- **evals:** Reduce memory eval flakiness (#973)
- **skill-builder:** Send skill URL as separate message for unfurl (#969)
- **context:** Specify ET timezone, add timezone clarification eval (#961)
- **pool:** Re-check counts before each auto-replenish create to prevent overshoot (#968)
- **pool:** Backfill GATEWAY_TOKEN on upgrade for older instances (#963)
- **dashboard:** Show upgrade button for crashed instances (#964)
- **evals:** Accept SILENT as valid stop response in delegation eval (#965)
- **evals:** Relax memory rubrics to reduce flakiness (#962)
- **openclaw:** Auto-remove eyes reaction after dispatch (#951)
- **openclaw:** Drop reasoning text, remove interrupt queue mode (#942)
- **ci:** Run all eval suites on every PR (#945)
- **ci:** Stamp check skips evals only, not build+publish (#933)
- **ci:** Use git log for stamp check + annotate fix (#930)

### Refactors & Docs
- **context:** Remove redundant Hermes IDENTITY.md (#958)
- **hermes:** Document all markers in MESSAGING.md (#959)
- **hermes:** Rename Convos adapter files to match OpenClaw layout (#949)
- Add response discipline for group conversations (#956)
- Add BAD/GOOD examples to all context sections and skills (#971)
- Rename verbosity eval to brevity eval (#972)
- Consolidate NGROK_URL into RAILWAY_PUBLIC_DOMAIN, remove fresh matrix field (#970)
- Extract eval triggers to .github/eval-triggers.yml (#940)
