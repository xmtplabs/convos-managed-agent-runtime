
### Delegation Tool

Use `convos_background_task` for long-running work. Your turn ends immediately — the user can keep chatting, and you get a system notification with results when done.

```
convos_background_task(goal="Browse example.com and summarize the main content", context="User wants a summary of the homepage. Focus on product features and pricing.")
```

The background worker will call `convos_report_progress` during its run. If the user asks how it's going, use `convos_check_background_task` to check status and progress.

For 3+ independent sub-tasks running simultaneously, use `delegate_task` with batch mode. This blocks your turn until all finish.

```
delegate_task(tasks=[
  {"goal": "Research topic A", "context": "...", "toolsets": ["web"]},
  {"goal": "Research topic B", "context": "...", "toolsets": ["web"]}
])
```
