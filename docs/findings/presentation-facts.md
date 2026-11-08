# Presentation and tour: checked numbers

Checked on Sunday 8 November 2026, about 01:50 UTC, against the live API (`https://htb.stefvuck.dev/api`), `CLAUDE.md` and the committed code. Every caption in `web/src/tour/tours.js` was read; this lists each claim, its source and what changed. The Remotion presentation (#252/#253) had not landed yet, so its scenes are **not** checked here: add them to this list when they do, using the same method.

## Figures that come live (the caption fetches them, so they cannot go stale)

| Caption | Source | Value when checked |
|---|---|---|
| GB and southern Norway day-ahead price | `/state`, `zones[].price.value` (GB in £/MWh, NO2 in €/MWh) | the map's own numbers |
| NESO constraint costs | `/unseen/ghost-wind`, `constraint_cost_total_gbp` | £205.4 million, but over **11 days** (17 to 29 October), not the last day |
| Live forecasts scored | `/scores`, `headline.forecasts_scored` | 301, scoring since 7 Nov 13:48 UTC |
| Average price error | `/scores`, `headline.mae_model` / `mae_persistence` | 33.0 against 43.2 (walk-forward backtest, 6,039 hours, pooled over zones) |

## Fixed statements

| Statement | Check | Result |
|---|---|---|
| Time bar reaches back to January 2024 | `HISTORY_START` in `panels/scrubber/timeline.js`; `/timeline` coverage from 2024-01-01 | true; GB price before 8 Sep 2026 is the Elexon market index, a proxy (the scrubber says so) |
| 26 October was the storm day | `/replay?event=2026-10-26`: GB constraint cost £36,530,869 (NESO daily total) | true |
| Replay uses models trained only on data before that day | same response, `trained_before: 2026-10-26` | true; 78 of 168 hours inside the P10 to P90 band |
| Orange marks on the strip are big events | `scrub-ev` fill `#f5a65b`, one per entry in `data/events/index.json` | true |
| Battery: 1 MW in every zone | `CLAUDE.md` feature 7 (1 MW / 2 MWh, 88% round trip) | true |
| Risk-aware battery matches or beats median-only | `/scores` `battery[]`, share of perfect foresight: BE 97.1/97.1, FR 94.8/94.8, NL 97.5/97.5, DE-LU 98.1 vs 81.7, GB 98.7 vs 95.1; NO2 has no share | true in all five zones with a score; equal in three |
| Hormuz closes: gas shock, bill in pounds | `/scenarios`: default 40% gas rise for 14 days, `cost_total_gbp` present, `method_note` states the pass-through approximates market coupling | true |
| Reveal: Monday's forecast frozen before the auction result | `CLAUDE.md` feature 11 | true by design; depends on `data/forecasts/frozen_monday.parquet` being the final freeze |

## Wording corrected (these were wrong or misleading before)

1. **Constraint costs "in the latest window"** read as the last day. The API total is eleven published days, 17 to 29 October (NESO runs about ten days behind). The caption now says "over the 11 days it has published, 17 October to 29 October", computed from the response.
2. **"N forecasts logged before their outcome, with an average error of 33.0"** joined two different things: 301 is the live scored count, 33.0 is the backtest over 6,039 hours. The caption now separates them and says "per MWh, pooled across zones".
3. **"Risk-aware loses less on bad hours"** is not what `/scores` reports (it reports profit and share of perfect foresight). Now: "matches or beats ... in every zone scored so far".

## Not checked, and why

- The battery headline pools zones and has a known caveat (#246: NO2 has no share, so the pooled 90.7% would be 97.3% without it). The tour does not quote the pooled number; the presentation should not either, or must say which pool.
- The "Live" chip and day-ahead prices can show fixture data offline; clips recorded from the live site were not compared with the offline pack.
- Explanation sentences (#247: "demand down 20% (+£10)" reads as a contradiction) should not be quoted until that is fixed.
