"""Mystery-day prediction market: a real past day, date hidden, played at speed for points only.

The live market runs in the SpacetimeDB module (spacetime/module/src/reducers/market.ts); this package builds
the questions, prices the model's view and drives the clock. `book.Book` is the same market in Python, so the
rules (LMSR pricing, settlement, Brier scores) are tested here and mirrored in the module.
"""
