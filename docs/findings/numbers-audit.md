# One number, one value: headline figures across app, README, tour and deck

Task #299. Checked 8 November 2026, 03:50 to 04:10 UTC.

**Sources:**
- live `https://htb.stefvuck.dev/api/*` (`/scores`, `/scenarios`, `/unseen/ghost-wind`, `/infrastructure`, `/replay`);
- `README.md`;
- `web/src/tour/tours.js`, `web/src/tour/chapters.js` with `numbers.js`, `web/src/copy/glossary.js`;
- the deck: `demo/presentation/data/snapshot.json` (generated 01:45 UTC), `src/data.ts`, `src/scenes/Scenes.tsx`, `docs/findings/presentation-facts.md`;
- the runner's `data/backtest/walk_forward.parquet`.

## Verdict

- **Fixed: README backtest figures.** The README quoted a backtest file that no longer exists. The 6-fold run of 23:45 (33.0 against 43.2, 79.9%, 6,039 hours) was replaced at 02:07 by a 12-fold day-ahead run. The app's Proof headline reads the new file: 33.3 against 52.3, 78.5%, 12,086 hours. I rewrote the README Results block to match it. The six-fold figures for load, wind and system price are kept, labelled as the earlier run.
- **Fixed: one false tour claim.** `tours.js` said the risk-aware battery "matches or beats" the median-only one "in every zone". Live, it doesn't in Belgium or the Netherlands. The deck's wording doesn't make that claim.
- **Deck: no typed numbers, only stale.** Every deck figure comes from `snapshot.json`, but that snapshot predates the new backtest and #246. It needs a fresh snapshot before rendering (posted to stefan-2).
- **Consistent everywhere:** Hormuz, the 26 October bill and B6. A judge sees the same value in each place.

## Table

"Live" means the `/scores` or `/scenarios` value at 03:51 UTC; the app and the tour's live tokens show these.

| Figure | Where | Value | Basis | Consistent? |
|---|---|---|---|---|
| Forecast error (MAE), our model | App Proof headline (`/scores` `headline.mae_model`, `basis: backtest`) | **33.3** | 12-fold day-ahead backtest, file of 02:07 | reference |
| | Tour `trust.scores` and `tours.js` `mae` | live token | same | yes |
| | README Results | was 33.0, now **33.3** | was the 6-fold file of 23:45 | **fixed** |
| | Deck Proof and Play (`F.maeModel`) | 33.0 | snapshot 01:45 | stale: re-snapshot |
| MAE, persistence | App, tour | **52.3** | 12-fold backtest | reference |
| | README | was 43.2, now **52.3** | | **fixed** |
| | Deck | 43.2 | snapshot | stale |
| "Better than persistence" | README | was 24%, now **36%** | 1 − 33.3/52.3 | **fixed** |
| | Deck (`maeImprovementPct`) | 24% | snapshot | stale |
| Backtest hours | App sentence ("12086 hours") | 12,086 | 12 folds × about 1,008 | reference |
| | README | was 6,039, now **12,086** | | **fixed** |
| | Deck | 6,039 | snapshot | stale |
| Likely-range (P10–P90) coverage | App, tour token | **78.5%** | 12-fold backtest | reference |
| | README | was 79.9%, now **78.5%** | | **fixed** |
| | Deck | 80% | snapshot | stale |
| | Glossary "likely range": "should fall inside 8 times out of 10" | target, not measured | | yes (it is the target) |
| Battery share of perfect foresight | App headline (`battery_share_of_perfect`) | **91.6%** | live, 5 zones pooled, 155 settled hours; NO2 not scored (#246) | reference |
| | Tour `whatif.battery` (`battery_risk`) | 91% | live, mean of 5 zone ratios (risk-aware 88.1 / 81.8 / 94.8 / 99.5 / 93.1%) | yes, rounding |
| | Tour caption text "Shares are averaged over the six zones" | | NO2 has no share: five | **wording**, flagged to the tour owner (`chapters.js` is not in this task) |
| | `tours.js` battery step: "matches or beats … in every zone" | | false live: BE 88.1% vs 90.7%, NL 93.1% vs 98.1% | **fixed** (no claim now) |
| | Deck (`batteryShare`) | 91% (0.9066, pre-#246, pooled over 6 zones incl. NO2) | snapshot | stale |
| Forecasts scored live | App sentence and tour token | 461 | live, since 13:48 Saturday | reference (rolls hourly) |
| | Deck | 301 | snapshot | stale; the slide label says "live", so re-snapshot just before the render |
| Hormuz cost (two weeks, +40% gas) | `/scenarios` | £1.75bn (P10 £1.05bn, P90 £2.46bn) | pre-computed scenario | reference |
| | Tour token, deck snapshot, presentation-facts | £1,754,592,000 | same file | yes |
| Hormuz, GB price change | `/scenarios`, tour, deck | +£38.33/MWh ("GB price up £38: gas up 40%") | same | yes |
| Constraint costs, latest window | `/unseen/ghost-wind`, `/infrastructure` | £205.4m over 11 published days (17 to 29 Oct) | NESO Constraint Breakdown | reference |
| | Tour `hidden.ghostwind` (token), `tours.js` `bill` | live | same | yes |
| | Hidden grid story card | newest day £18.8m (29 Oct) | same API, newest day | yes (different, labelled quantity) |
| 26 October constraint bill | `/replay`, README, tour fallback and token, deck, `engine/reference` fact | £36.5m (£36,530,868.70) | NESO daily Constraints category | yes |
| B6 boundary | README | 6.7 GW planning capability (ETYS 2025); "typical B6 limit is ~6GW" (NESO) | sourced quotes | reference |
| | `/infrastructure` `etys_capability.B6` | 6,700 MW | ETYS 2025 | yes |
| | `/infrastructure` SCOTEX `max_capacity_mw` | **6,800 MW** (NESO OTF, 7 Oct 2026; hard-coded in `engine/infrastructure.py`) | different source | **mismatch, not visible**: the web app never displays `max_capacity_mw` |
| | `/infrastructure` SCOTEX day-ahead | median limit 3.5 GW, mean flow 3.6 GW, over its limit 34% of hours (21 days) | NESO day-ahead flows | yes; the story card shows 34% |
| Bottleneck saving | Story card, `/infrastructure` counterfactual | £57.7m over 11 days with +2 GW across B6 | estimate | yes |

## Which is right, and why

- **Backtest figures:**
  - **Right: the 12-fold run of 02:07.** `pipeline/backtest.py` writes the file the app reads (`engine/routes/scores.py` reads `backtest/walk_forward`), and the same file gives 33.26 / 52.30 / 0.785 / 12,086 hours when pooled by `n`, as I recomputed.
  - The 6-fold run of 23:45 is gone from the runner; only `walk_forward.parquet.pre-calibration-1653` is left.
  - Persistence is much worse in the 12-fold run (52.3 against 43.2) because of the extra six weeks, mid-August to late September. There, persistence error is 61.2 and the model's 30.4; in the six recent folds they are 43.3 and 36.1, matching the old run. NO2 is level with persistence (ratio 1.01) rather than losing (1.12).
- **Battery:** the app headline (91.6%, pooled profit over the five scored zones) and the tour token (91%, mean of the five zone ratios) are different calculations that happen to agree today. If they drift apart, the tour should use `headline.battery_share_of_perfect`, as `qa-tour-facts.md` already suggests.
- **B6:**
  - **Right: 6.7 GW**, the ETYS planning capability, as the README says, alongside NESO's "~6 GW typical".
  - The 6,800 in `/infrastructure` comes from a forum slide and is not shown anywhere a judge can see it.
  - Smallest fix: drop `max_capacity_mw` or set it from `etys_capability` (lane B, `engine/infrastructure.py`). No change made, because it isn't visible.

## Changes made

| File | Change |
|---|---|
| `README.md` Results | Headline table, ratio, coverage and hours from the current backtest file (33.3 / 36.7 / 52.3, 36%, 78.5%, 12,086 hours, 12 folds). The six-fold figures for load, wind and system price are kept and labelled with their run. |
| `web/src/tour/tours.js` | Battery step no longer claims risk-aware beats median-only in every zone. The NO2 price fallback "far cheaper" becomes "its own price" (NO2 €193 against GB £181, about €208, tonight). |

## Posted on the bus

- **stefan-2 (deck):** re-snapshot before rendering. MAE 33.0 → 33.3, persistence 43.2 → 52.3, 24% → 36%, 6,039 → 12,086 hours, coverage 80 → 78%, battery 91% (pre-#246, 6 zones) → 91.6% (5 zones), scored 301 → 461 and rising.
- **Tour owner (`chapters.js`):** "Shares are averaged over the six zones" should say five, or "the zones where perfect foresight made money".
