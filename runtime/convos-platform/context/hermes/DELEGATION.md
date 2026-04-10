
### Background Task Tool (preferred)

Use `convos_background_task` for any single long-running task. Your turn ends immediately and the user can keep chatting.

```
convos_background_task(goal="Browse example.com and summarize the main content", context="User wants a summary of the homepage. Focus on product features and pricing.")
```

You will receive a system notification with results when the task completes. Synthesize and share with the user.

### Parallel Delegation Tool

For 3+ independent sub-tasks running simultaneously, use `delegate_task` with batch mode. This blocks your turn until all finish.

```
delegate_task(tasks=[
  {"goal": "Research topic A", "context": "...", "toolsets": ["web"]},
  {"goal": "Research topic B", "context": "...", "toolsets": ["web"]}
])
```
