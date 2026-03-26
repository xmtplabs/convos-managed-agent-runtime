---
name: new
description: Start a new PR workflow — creates a worktree, syncs latest dev, and branches off for a new feature.
disable-model-invocation: true
---

Start a new PR workflow.

Steps:

1. **Ask the user** what they want to work on. From their answer, generate a short kebab-case branch name (e.g. `fix/pool-crash`, `feat/add-retry-logic`).
2. **Enter a worktree** using the EnterWorktree tool to get an isolated copy of the repo.
3. **Sync and branch from dev:**
   ```
   git fetch origin dev
   git checkout -b <generated-branch-name> origin/dev
   ```
4. Confirm the branch is ready and start working on the task.
5. When done, create a PR targeting `dev`.
6. First, make sure the build and lint and format passes
7. **After pushing/creating the PR**, a runtime CI pipeline will run. You MUST wait for it to complete by polling ervery 3 minutes. Once it passes (or fails), keep iterating until it passes.

Important:

- Always branch from `origin/dev` per project conventions.
- Keep branch names short and descriptive with a prefix (`feat/`, `fix/`, `refactor/`, `chore/`).
- Never skip the CI check step — always wait and report the outcome.
