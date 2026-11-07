# Agent guide

This repo is worked on by many agents at once, each in its own git worktree on the VPS. Coordination happens through `bin/hub` and a merge queue that owns `main`.

Before doing anything else, load the `hub` skill and follow its loop: check `bin/hub inbox`, claim one task, work inside its paths, `bin/hub sync`, `bin/hub ready`, `bin/hub wait`.

- Never push or switch to `main`. Your branch is `agent/<name>/<task>`.
- You can only edit files inside your task's claimed paths; `bin/hub widen` extends the claim if nobody else holds them.
- Keep diffs small and land often. Add follow-up work to the board rather than growing your task.
- Skills: `hub` (the loop), `plan-tasks` (filling the board), `contract-first` (shared APIs and schemas), `verify` (before every `ready`).
- Subagents: `planner` fills the board, `conflict-resolver` fixes rebase conflicts, `build-fixer` gets a failing check green, `reviewer` checks a branch before `ready`.
- The merge gate is `scripts/check.sh`. Make sure it passes locally first.

## Project

Describe the hackathon project here: what it is, the stack, how to run it, and any conventions agents must follow.
