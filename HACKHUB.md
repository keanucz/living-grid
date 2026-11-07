# hackhub

A baseline repo for running many coding agents against one codebase during a hackathon without git falling over. Agents work in parallel on their own branches; a merge queue on a VPS owns `main` and lands work one task at a time, only when it passes your checks. You keep all of git: history, blame, bisect, revert, GitHub.

## How it works

Everything runs on one VPS. There is a bare repo that acts as the single remote, an integrator clone that runs the merge queue as a systemd service, and a work clone from which each agent gets its own `git worktree`. Because the worktrees share one object store, agents never wait on network fetches to see each other's work, and rebasing onto `main` is instant.

Coordination lives in a small SQLite task board (`hub.db`) driven by `bin/hub`, a single dependency-free Python script. Each task carries the paths it expects to touch, and `bin/hub claim` refuses a task whose paths overlap with work another agent already has in flight. That one rule removes most conflicts before they happen.

When an agent finishes it runs `bin/hub ready`. The integrator takes ready tasks in order, squashes each onto the latest `main`, runs `scripts/check.sh`, and fast-forwards `main` only if it is green. If the branch conflicts or the check fails, the task is bounced back to its agent with the conflicted files or the failing output attached, and the agent fixes it and resubmits. A `pre-receive` hook on the bare repo rejects any push to `main` that does not come from the integrator, so nobody (human or agent) can skip the queue.

```
 agents/alice ─┐                         ┌─> check.sh ─> main
 agents/bob   ─┼─ agent/* branches ─> merge queue
 agents/carol ─┘        │                └─> bounce note ─> agent fixes, resubmits
                    hub.db (tasks, claims, notes)
```

## What the agents get

The `.claude/` directory makes this work out of the box with Claude Code.

There are four skills. **`hub`** teaches the loop: check the inbox, claim one task, work inside its paths, sync, verify, ready, wait, repeat. **`plan-tasks`** explains how to slice a goal into small, path-scoped tasks with shared contracts landing first, which is where most of the real conflict avoidance comes from. **`contract-first`** covers how to define and change an API or schema boundary that several agents build against at once. **`verify`** is the checklist an agent runs before handing work to the queue: the gate, types and lint, a test for the change, a sweep of the diff for secrets, debug output and swallowed errors, and a scope check against the claimed paths, finishing with a handoff note.

There are four subagents. `planner` fills the board from a goal and spots files that keep colliding. `conflict-resolver` works through a stopped rebase, reading what the other agent was trying to do so both intents survive. `build-fixer` gets a failing check green with the smallest possible diff. `reviewer` checks a branch before it goes to the queue, including for silent failures.

`settings.json` wires in hooks. On session start each agent is shown the board and its inbox, and whenever an agent stops (or a subagent finishes) its work is committed and pushed to its branch, so nothing is ever stranded in a worktree. Before every edit and shell command, `bin/hub guard` runs: it refuses writes outside the task's claimed paths (pointing the agent at `bin/hub widen`, which extends the claim only if no one else holds those paths), refuses edits before a task is claimed, and blocks destructive commands such as `git push`, `git reset --hard`, `git clean -f`, `--no-verify`, `rm -rf .` and `DROP TABLE`. This keeps the board honest: the overlap check at claim time is only as good as agents staying within what they claimed.

### Credits

`contract-first` is taken from [Everything Claude Code](https://github.com/affaan-m/ecc) with a hub-specific section added. `verify`, `build-fixer`, the reviewer's silent-failure checks and the guard hook are adapted from ECC's `verification-loop`, `build-error-resolver`, `silent-failure-hunter` and `safety-guard`. ECC is MIT licensed; its licence is in `.claude/ECC-LICENSE`.

## Setup

You need a Linux VPS with Python 3.11 or newer and git. Two or four cores and 4 to 8 GB of RAM comfortably runs five or six agents plus the check.

```bash
git clone <this repo> hackhub && cd hackhub
# edit CLAUDE.md (project description) and scripts/check.sh (your build and tests)
sudo ./scripts/vps-setup.sh /srv/hack alice bob carol
```

That creates the bare repo with the hook, the integrator and work clones, a shared `hack` group so everyone's agents can use the same board, and starts the `hub-integrator` service. Each teammate then needs SSH access as their user and the Claude Code CLI installed and signed in.

To start an agent:

```bash
cd /srv/hack/work
bin/hub spawn alice-1
cd /srv/hack/agents/alice-1 && claude
```

Run each agent in its own `tmux` window so they survive disconnects. A good first prompt for the very first agent is "use the planner subagent to plan: <your idea>". Every other agent can simply be told "work through the board".

Laptops can still clone `ssh://<user>@<vps>/srv/hack/repo.git` to read and test `main` locally, but the board is a local SQLite file, so agents themselves should run on the VPS.

## Day-to-day

```bash
bin/hub list            # the board
bin/hub log -n 50       # what every agent has been doing
journalctl -u hub-integrator -f    # live merge queue
bin/hub add "Title" -d "acceptance check" -p src/thing/   # add work by hand
bin/hub release 7       # free a task an agent abandoned
bin/hub show 7          # detail, handoff note and any bounce reason
```

## Configuration

`hub.toml` sets the main branch, the check command and its timeout, and whether merges are squashed (one commit per task, the default) or rebased to keep each agent's commits. The integrator reads it at start-up, so restart the service after changing it: `sudo systemctl restart hub-integrator`. `HUB_CHECK` in the environment overrides the check command, and `HUB_AGENT` overrides an agent's name, which otherwise comes from its worktree folder.

Keep `scripts/check.sh` fast. It runs once per task, serially, so a five-minute test suite caps you at twelve merges an hour. For anything slow, gate on a quick build plus smoke tests and run the full suite separately.

## Tips that matter more than tooling

Land the shared types, API shapes and schema first, as one task, before fanning out. Keep tasks to 30 to 45 minutes; long-lived branches are what make conflicts painful. Make hot files (route tables, barrel exports, dependency manifests) either finished early or structured so each feature registers itself in its own file. When `bin/hub log` shows the same file bouncing repeatedly, have the planner add a task to split it.
