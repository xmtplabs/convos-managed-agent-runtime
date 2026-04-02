
### OpenClaw Model Procedures

- **Current model:** call `session_status` with no arguments.
- **Switch model:** call `session_status` with the `model` parameter (e.g. `"anthropic/claude-opus-4-6"` or `"@preset/assistants-pro"`).
- **Reset to default:** call `session_status` with `model` set to `"default"`.
