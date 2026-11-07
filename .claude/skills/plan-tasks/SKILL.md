---
name: plan-tasks
description: Break a hackathon goal or feature into small, parallel, low-conflict tasks on the hub board. Use when asked to plan the project, split up work, or fill the board for other agents.
---

# Planning work for many agents

The aim is a board where several agents can work at once without editing the same files. Good planning prevents more conflicts than any merge tooling.

## Steps

1. **Read the current state.** Skim the repo layout, `README.md`, and `bin/hub list -a` so you do not duplicate tasks or plan against code that has already moved.
2. **Find the seams.** Identify the shared contracts: API routes and payloads, database schema, shared types, component props, config keys. List them explicitly.
3. **Contracts first.** Follow the `contract-first` skill for any boundary with an independent consumer (frontend and backend, two services, an event stream). Create one task (or a very small number) that defines those contracts as code: type definitions, an OpenAPI or schema file, stub functions with the right signatures returning fixtures. Mark it so it is obvious it must land before dependants, for example by prefixing the title with `[FIRST]`.
4. **Slice vertically by file ownership.** Every other task should own a distinct set of paths. Prefer "the leaderboard page" over "all the CSS". Give each task:
   - a title an agent can act on without asking questions,
   - a detail that states the acceptance check (what you would run or click to see it working) and which contract it builds on,
   - a `-p` list of the paths it will create or edit. Be tight but complete: the guard hook stops agents writing outside these, so a missing test directory or config file means a `widen` round trip. Include the task's own test files.
5. **Size them.** Each task should be 30 to 45 minutes of agent work. Split anything bigger.
6. **Isolate hotspots.** Files that everyone wants to edit (route tables, `index.ts` barrels, dependency manifests, global CSS) should either be finished in the contract task or be designed so each feature registers itself in its own file.
7. **Write them to the board** with `bin/hub add`, contracts first. Then print `bin/hub list` and a short note of which tasks can start immediately and which wait on the contracts.

## Example

```
bin/hub add "[FIRST] API contract and shared types" \
  -d "Define types in src/shared/types.ts and stub every route in src/api/routes.ts returning fixtures. Accept: npm test passes, every route returns 200." \
  -p src/shared/ src/api/routes.ts package.json
bin/hub add "Leaderboard page" \
  -d "Render GET /scores as a sortable table. Accept: page loads with fixture data." \
  -p src/web/pages/leaderboard/
bin/hub add "Scores endpoint backed by SQLite" \
  -d "Replace the GET /scores fixture with a real query. Accept: new test in tests/scores.test.ts passes." \
  -p src/api/scores/ tests/scores.test.ts
```
