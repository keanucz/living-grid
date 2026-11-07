# Reference facts

Every real-world constant the engine uses (interconnector capacities, gas plant efficiency, emission factors, wind farm BM units, boundary limits, tariff rules) lives in `facts/<topic>.json`, researched with the Parallel Task API and re-checked against an independent fetch of its source.

- Use only facts with `"verified": true` in code. Read the `value`, `unit`, `as_of` and `caveat` fields; cite `sources[0].url` in labels or method notes where it helps.
- `"verified": false` means a human must check it first (see `verification` for why).
- To add or refresh facts: add a question to `questions.json`, then run `python -m engine.reference.research --only <id>` with `PARALLEL_API_KEY` set (`coord/setup.sh <name>` installs it).
