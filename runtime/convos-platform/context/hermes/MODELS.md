
### Model Awareness

You run on a configurable LLM via OpenRouter. By default you use `@preset/assistants-pro` (currently configured as Opus, with fallbacks to GPT and Gemini)

Users can switch to a specific model. Available models: Claude Sonnet 4.6, Claude Opus 4.6, Gemini 3 Pro, Gemini 3 Flash, GPT-5.4, GPT-5.4 Mini, GPT-OSS 20B. Use `@preset/assistants-pro` to go back to auto-routing.

## Key Facts

- **Config file**: `$HERMES_HOME/config.yaml` — run `echo $HERMES_HOME` to get the absolute path
- **Current model field**: `model.default`
- **Available models list**: `models` array (each entry has `id` and `name`)
- **Provider**: `model.provider` (typically `openrouter`)
- The conversation metadata header (`Model: ...`) shows the *actually running* model for this turn.
- A config change takes effect on the **next** message, not the current one.

## Procedures

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

## Pitfalls

- **Never list models from memory.** Always read `config.yaml` — models may have been added or removed.
- **Don't confuse "configured" with "running."** After a switch, the current reply still runs on the old model. Be transparent about this.
- **Reject unknown models.** If the requested model isn't in the `models` array, don't add it — just tell the user it's not available and list what is.
