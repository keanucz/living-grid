---
name: hub
description: How to work in this shared multi-agent repo. Use at the start of every coding session and whenever you pick up, finish, sync or fix a task, or a merge is bounced.
---

# Working in a hub repo

Several agents are editing this codebase at once, each in its own git worktree on its own branch. Nobody pushes to `main`; a merge queue on the VPS squashes finished branches onto it one at a time and only lands them if `scripts/check.sh` passes. Your job is to keep your branch small, current and green.

All coordination goes through `bin/hub`. Run it from the repo root.

## The loop

1. **Look before you start.** `bin/hub inbox` shows anything of yours that was bounced; deal with those first. Then `bin/hub list` for the board.
2. **Claim exactly one task.** `bin/hub claim <id>` switches you to `agent/<you>/<id>-...` branched from the latest `main`. If it refuses because of overlapping paths, pick another task rather than forcing it. Only use `--force` when the overlap is clearly harmless (for example both tasks append to a shared index file).
3. **Do the work.** Edits are limited to the task's claimed paths: a guard hook blocks writes anywhere else. If a change outside them genuinely belongs in this task (a one-line config entry, say), run `bin/hub widen <path>`, which only succeeds if no other agent has that path claimed. If it is refused, or the change is really separate work, `bin/hub add` a follow-up task instead. The same hook blocks destructive commands such as `git push`, `git reset --hard` and `rm -rf .`; if one is blocked, read the reason and use the alternative it gives.
4. **Save often.** Commit with normal messages whenever something works; `bin/hub save` commits anything outstanding and pushes your branch. A hook also saves whenever you stop, so work is never stranded on this machine.
5. **Sync and verify.** `bin/hub sync` rebases onto the latest `main`. Fix any conflicts now (see below), then follow the `verify` skill.
6. **Hand it in.** `bin/hub ready -m "<what changed, how you verified it, caveats>"`, then `bin/hub wait`. Exit 0 means merged. Exit 1 means bounced: read the note it prints and go back to step 5. For a failed check, the `build-fixer` subagent makes the minimal fix.
7. **Next.** Once merged, claim the next task. Your old branch is finished; never reuse it.

## Conflicts

`bin/hub sync` stops and lists the conflicted files. For each one, read both sides and the commit on `main` that introduced theirs (`git log -p -1 origin/main -- <file>`). Keep both intents; never just take your side. Then `git add <file>`, `git rebase --continue`, and repeat until the rebase finishes. If the conflict is large or touches code you do not understand, hand it to the `conflict-resolver` subagent.

## Rules

- Never `git push`, never touch `main` directly, never `git reset --hard` on someone else's branch. The server rejects pushes to `main` anyway.
- One task per branch. If you discover extra work, `bin/hub add "<title>" -p <paths>` so another agent can take it, instead of growing your diff.
- Prefer small tasks that land within 30 to 45 minutes. A big diff that sits unmerged for hours is the main cause of painful conflicts.
- Interfaces and shared types land first. If your task depends on one that is not on `main` yet, either wait for it or claim it yourself.
- If you abandon a task, `bin/hub release <id>` so it goes back on the board.

## Command reference

| Command | Does |
|---|---|
| `bin/hub list [-a]` | board (add `-a` to include merged) |
| `bin/hub show <id>` | full task detail and latest bounce note |
| `bin/hub add "<title>" -d "<detail>" -p <paths...>` | new task |
| `bin/hub claim <id> [--force]` | claim and switch to its branch |
| `bin/hub save` | commit everything and push the branch |
| `bin/hub sync` | rebase onto latest main |
| `bin/hub widen <paths...> [--force]` | extend your claim, if nobody else holds those paths |
| `bin/hub ready -m "<handoff>"` | queue for merge with a handoff note |
| `bin/hub wait [id]` | block until merged (0) or bounced (1) |
| `bin/hub inbox` | your outstanding tasks and notes |
| `bin/hub release <id>` | give a task back |
| `bin/hub log` | recent activity across all agents |
