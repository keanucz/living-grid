# Reference facts

Every real-world constant the engine uses (interconnector capacities, gas plant efficiency, emission factors, wind farm BM units, boundary limits, tariff rules) lives in `facts/<topic>.json`, researched with the Parallel Task API.

A fact is `"verified": true` only when both hold:

1. **Cross-check:** a second, independent Parallel Task run (`pro`), told the claim but asked to find its own sources, agrees.
2. **Figures:** every figure in the answer (years ignored when other figures exist) re-appears in an independent Extract fetch of the cited sources, allowing only x1000 unit scaling and rounding.

Human decisions live in `manual.json`, override both checks, survive re-runs, and are marked `manual_override` on the fact.

- Use only `verified: true` facts in code. Read `value`, `unit`, `as_of` and `caveat`; `verification` says how it was checked.
- `verified: false` means a human must look first; `verification` says why (often a derived figure, or a cross-check disagreement worth reading).
- Commands (need `PARALLEL_API_KEY`, installed by `coord/setup.sh <name>`):
  - `python -m engine.reference.research --only <id>`: research and verify
  - `python -m engine.reference.research --reverify`: new cross-checks for existing facts
  - `python -m engine.reference.research --refigure`: redo only the figure check
