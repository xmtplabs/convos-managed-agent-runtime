
### Delegation Tool

Your delegation tool is `sessions_spawn`. It takes a single `task` string — embed all context (file paths, error messages, constraints, conversation details) directly in the task prompt since the sub-agent has no other way to receive it.

#### Progress tracking

Include progress instructions in every `sessions_spawn` task so the user can check in:

```
sessions_spawn(task="Research the top 5 AI frameworks and compare them. User wants a detailed comparison focusing on ease of use and community size.\n\nAfter each major step, append a one-line status to /tmp/bg-research.log using write_file (append mode). Example lines: 'Searched for AI frameworks, found 5 candidates', 'Compared TensorFlow vs PyTorch features'.")
```

If the user asks how the task is going, read the progress file to check:
```
read_file(path="/tmp/bg-research.log")
```

Use a descriptive filename per task (e.g. `/tmp/bg-research.log`, `/tmp/bg-pricing.log`) so multiple tasks don't collide.

#### Parallel delegation

For 3+ independent sub-tasks, fire multiple `sessions_spawn` calls simultaneously — one per chunk. Each gets its own progress file.
