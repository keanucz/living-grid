# Deck review: round 1 (judge: stefan-4)

Reviewed from `review/round-1/` (contact sheet, 24 stills, `frames.md`), `demo/presentation/README.md` and `data/snapshot.json` (taken 2026-11-08 01:45 UTC). Test: "forecast-first: one honest forecast, many uses, proven in public".

**Panel average: 5.0 / 10. Not shippable.** One blank scene and three number problems are blocking.

## Scores (1-10)

| Criterion | G-Research quant | HRT engineer | Presentation coach |
|---|---|---|---|
| Thesis clarity | 6 | 5 | 6 |
| Evidence | 6 | 5 | 4 |
| Honesty about uncertainty | 5 | 5 | 5 |
| Visual clarity and legibility | 5 | 5 | 4 |
| Pacing | 5 | 5 | 4 |
| Memorability | 5 | 5 | 5 |
| Accuracy against snapshot and README | 4 | 4 | 5 |
| **Mean** | **5.1** | **4.9** | **4.7** |

Overall 5.0. Quant: the proof is real (baseline, coverage, frozen forecast on a public chain) but the headline numbers are mislabelled or stale. HRT: nothing a trader or battery owner could act on is shown; the product scene, the only place it could be, is mostly empty. Coach: hook and problem are good, then the deck goes flat; small grey captions will not survive a projector.

## Blocking: factual or rendering errors

1. **Product scene is blank white at 60% (`product-60.png`, 39 s).** A whole mid-scene frame is empty. Sixty-five seconds of the three-minute deck is the product, and the stills show only a Hormuz card (25%) and a data-centre card (95%). The README admits only ghostwind, hormuz and history have clips, the rest fall back to a title card, and the Player probably shows cards. A judge sees a card with a number and no product.
2. **Play scene: "OUR AVERAGE ERROR TO BEAT (£ PER MWH, BACKTEST) 33.0" is a wrong unit.** 33.0 (and Proof's 33.0 vs 43.2) is `mae_model` pooled over six zones, GB in £ and the rest in €. Say "per MWh, pooled over six zones (£ and €)" or show GB-only and EUR-only figures. A quant will spot it in seconds (manu-1 flagged the same).
3. **Proof scene: "91% battery profit vs perfect foresight" is stale.** Snapshot 0.9066 over 6 zones, which includes NO2 (no share). After #246 the live figure is 0.9465 over 5 zones. Re-run `scripts/snapshot.mjs` and label the zone count.
4. **"This is the price across Europe right now" with a 01:45 UTC snapshot.** The footer says 01:45 while the deck is shown at 12:30. Say "on 8 Nov, 01:45 UTC", or drop "right now". Note also four zones all show €215, which looks like a placeholder to an outsider; add one clause that coupled markets clear at one price.

## Five highest-value changes (ranked)

1. **Product scene (65 s): replace blank and card-only segments with real footage or live stills of the app, one idea per 13 s.** Make every segment a captured screen with one on-screen number (Hormuz £1.8bn with its range, the 26 Oct replay, ghost wind £36.5m, cheapest hours). Never render a blank frame; add a render check that fails on an all-white still. Why: it is a third of the deck and what the HRT track scores.
2. **Fix the three numbers above (33.0 unit, 91% stale and zone count, "right now").** Add the base: "6,039 hours, six zones, pooled £ and €". Why: accuracy is the lowest score from both experts.
3. **Proof scene: one slide with the whole honest story.** Model 33.0 vs persistence 43.2 (24% smaller), coverage 79.9% against an 80% aim (it says 80%; show 79.9), 301 live-scored forecasts (separate from the 6,039-hour backtest, say so), and the line already in the caption: against a strong day-ahead rival it is a tie. Give that tie a number and promote it from a caption to the slide. Why: the deck's thesis is "honest", and the best honesty is currently in 10 px text.
4. **Legibility: raise all captions, axis labels, footers and source lines to at least 28 px (headline 72 px+), and drop the chart axes that carry no number.** In every still the caption is a thin grey box under a chart; the stat labels ("BE: MADE AT HOME, PER KWH") are tiny uppercase mono. Why: the room is 10 m away on a projector.
5. **Pacing and memorability: cut "Three people and a lot of Claudes" to 8 s and give those seconds to Proof; merge Play's 15 s into the close.** Play repeats the 33.0 and has no visual; How shows 234 tasks as a 144 → 234 grid animation that carries no argument for the judges. End on one memorable image: the frozen forecast meeting the real auction (Monday 09 Nov), not a QR on a black page. Why: the three-minute story is hook, problem, forecast, proof; the build story is a footnote.

## Other notes (not blocking)

- Hook: strong. Problem: "Prices swing hard" then "£36.5m" then "342 g / 379 g / 19%" are three ideas in 20 s; the third scene needs the map or a bar to match its headline.
- "What we built" repeats the problem chart (26 Oct) with a band; say that the forecast was made with data from before the day (it does, in a tiny caption: make it the title).
- The forecast band on 26 Oct visibly misses the peaks; show that. A forecast that hides its misses is not honest; one that shows them is.
- Numbers traced by `frames.md` are "yes", but "traced" means the value exists in the snapshot, not that its label is right (see 2 and 3).
- Vision test: See (hook, problem) yes; Understand yes; Test weak (no live what-if); Trust half; Use no.
