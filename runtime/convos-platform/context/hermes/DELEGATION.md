
### Delegation Tool

Your delegation tool is `delegate_task`. Pass all context in `goal` and `context` fields.

For independent sub-tasks, use batch mode — up to 3 run in parallel:
```
delegate_task(tasks=[
  {"goal": "Research topic A", "context": "...", "toolsets": ["web"]},
  {"goal": "Research topic B", "context": "...", "toolsets": ["web"]}
])
```
