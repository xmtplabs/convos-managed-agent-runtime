Your model config lives at `$HERMES_HOME/config.yaml`.

**IMPORTANT:** Always use `$HERMES_HOME` to resolve the config path — run `echo $HERMES_HOME` first if you need the absolute path for file edits. Never hardcode paths like `/home/user/.hermes/`.

- **Current model:** read the `model.default` field in `$HERMES_HOME/config.yaml`.
- **Available models:** read the `models` list in `$HERMES_HOME/config.yaml`. Only models in that list are supported.
- **Switch model:** when a user asks to switch, read `$HERMES_HOME/config.yaml` to get the available models and the absolute path, then patch `model.default` to the new model ID using that resolved path. If the model is not in the list, decline and show what's available.
