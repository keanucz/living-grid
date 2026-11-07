---
name: verify
description: Verify a task branch before handing it to the merge queue. Runs build, types, lint, tests, a secrets and debug-output sweep, and a scope check against the task's claimed paths, then writes the handoff. Use before every bin/hub ready.
metadata:
  origin: adapted from ECC verification-loop (github.com/affaan-m/ecc, MIT)
---

# Verify before ready

The merge queue only runs `scripts/check.sh`. Everything else that makes a branch safe to land on top of other agents' work is checked here, by you, before `bin/hub ready`. A bounce costs a full round trip through the queue, so catch it now.

Run `bin/hub sync` first so you are verifying against the latest `main`, not a stale one.

## Phases

Stop at the first phase that fails, fix it, and restart from phase 1.

1. **Gate.** `./scripts/check.sh`. This is exactly what the queue will run. If it fails on a build or type error, the `build-fixer` subagent can make the minimal fix.
2. **Types and lint.** Whatever the stack offers and `check.sh` does not already cover: `npx --no-install tsc --noEmit`, `npm run lint`, `ruff check .`, `pyright`, `cargo clippy`, `go vet ./...`, `clang-tidy`. Fix errors in files you touched. Ignore pre-existing warnings elsewhere; they are not your task.
3. **Tests for your change.** There should be at least one test or reproducible check that exercises the task's acceptance criterion. If there is none, add one inside your claimed paths.
4. **Sweep the diff.** Run against `git diff origin/main...HEAD` only, never the whole repo:
   - secrets and keys: `sk-`, `api_key`, `password=`, `BEGIN PRIVATE KEY`, `.env` contents
   - leftover debugging: `console.log`, `print(`, `dbg!`, `debugger`, commented-out blocks
   - swallowed errors: empty `catch`, `except: pass`, `.catch(() => [])`, fallbacks that hide failure
5. **Scope.** `git diff --stat origin/main...HEAD` and compare with `bin/hub show <id>`. Every file should be within the claimed paths. Anything outside them must be deliberate, minimal, and already added with `bin/hub widen`.
6. **Contracts.** If you touched a shared type, schema or API shape, stop: that belongs in a contract task (see the `contract-first` skill), not here.

## Report and hand off

Produce this, then pass a condensed version as the handoff note:

```
VERIFY #<id>
Gate:     PASS
Types:    PASS
Lint:     PASS (2 pre-existing warnings, untouched)
Tests:    PASS  added tests/scores.test.ts
Sweep:    PASS
Scope:    PASS  4 files, all in src/api/scores/
Contract: unchanged
```

```bash
bin/hub ready -m "GET /scores now reads SQLite. Verified: check.sh, new tests/scores.test.ts. Caveat: no pagination yet, added #12."
bin/hub wait
```

The handoff is what the reviewer and other agents see on `bin/hub show`. Say what changed, how you know it works, and anything you deliberately left out.
