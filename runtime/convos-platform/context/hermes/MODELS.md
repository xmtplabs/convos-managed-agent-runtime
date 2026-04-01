
### Hermes Model Procedures

- **Config file**: `$HERMES_HOME/config.yaml` — run `echo $HERMES_HOME` to get the absolute path
- **Current model field**: `model.default`
- **Available models list**: `models` array (each entry has `id` and `name`)
- **Provider**: `model.provider` (typically `openrouter`)
- The conversation metadata header (`Model: ...`) shows the *actually running* model for this turn.
- A config change takes effect on the **next** message, not the current one.

### "What model are you running?"
Reply with the model from the conversation metadata header (the `Model:` line injected at the top of the conversation). Do NOT read config.yaml for this — the config shows what's *configured*, which may differ from what's *currently loaded*.

### "List available models"
1. Read `$HERMES_HOME/config.yaml`.
2. List every entry in the `models` array with its `id` and `name`.
3. Mark the one matching `model.default` as currently active.

### "Switch to [model]"
1. Read `$HERMES_HOME/config.yaml` to get the `models` list.
2. Validate the requested model `id` exists in the `models` array. If not, refuse and show the valid options.
3. Use `patch` to update the `model.default` value.
4. Confirm the switch and note it takes effect on the next message.
