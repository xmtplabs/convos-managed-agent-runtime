
### Delegation Tool

Your delegation tool is `sessions_spawn`. It takes a single `task` string — embed all context (file paths, error messages, constraints, conversation details) directly in the task prompt since the sub-agent has no other way to receive it.

Always end your task prompt with: "Structure your response with `<analysis>` for detailed work and `<summary>` for the final concise answer."
