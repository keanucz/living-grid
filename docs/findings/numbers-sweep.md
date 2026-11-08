# Numbers sweep before submission

Task #332. Checked 8 November 2026, 07:20 to 07:30 UTC, on main after #327 and #330.

**Files checked:**
- `README.md`;
- `demo/writeup/devpost.md`;
- `demo/scripts/README.md`, `g-research-first.md` and `hrt-first.md`;
- the deck: `demo/presentation/data/snapshot.json` with `src/data.ts`, `src/figs.ts` and `src/scenes/Scenes.tsx`, plus stefan-2's open #282 branch;
- user-facing copy in `web/src`, grepped for MAE, %, of 168, £, €, GWh, bn and folds.

**Sources:**
- live `https://htb.stefvuck.dev/api/` `scores` (as of 06:00), `scenarios` (pre-computed 21:29 Saturday), `replay`, `unseen/ghost-wind` and `unseen/carbon`;
- the runner's `data/backtest/walk_forward.parquet` (05:05) and `bot_league.parquet` (02:07);
- `docs/findings/calm-day-replay.md` (#163);
- `engine/reference/facts/`.

## Verdict

- **Write-up and spoken scripts:** match the sources, after #327 and #330.
- **App copy:** consistent. Headline figures are live tokens. The typed figures (£36.5m for 26 October, 12 hours ahead, 88% round trip, target 80%) match their sources.
- **Three mismatches remain:**
  1. **Deck:** the snapshot is stale, so every deck figure is from 01:45 (sent to stefan).
  2. **README bot league:** the section is from Saturday 20:57, and the current file reverses its headline finding (sent to Keanu, since `README.md` is shared).
  3. **Tour, `chapters.js`:** still says "averaged over the six zones" for the battery (sent to manu).

## Table

"Live" is the API value at 07:17 to 07:26 UTC. ✓ means it matches the source; **stale** or **mismatch** needs a change.

| Figure | Source value | README | Write-up | Scripts | Deck (snapshot 01:45) | App |
|---|---|---|---|---|---|---|
| Day-ahead MAE, our model | 33.3 (12 folds, `walk_forward` 05:05; `/scores` `mae_model` 33.26) | 33.3 ✓ | 33.3 ✓ | 33.3 ✓ | **33.0, stale** | live token ✓ |
| Same hour yesterday | 36.7 | 36.7 ✓ | 36.7 ✓ | not quoted | not shown | not shown |
| Persistence | 52.3 | 52.3 ✓ | 52.3 ✓ | 52.3 ✓ | **43.2, stale** | live token ✓ |
| Better than persistence | 36% | 36% ✓ | 36% ✓ | 36% ✓ | **24%, stale** | not shown |
| Backtest hours, folds | 12,086 hours, 12 folds | ✓ | ✓ | ✓ | **6,039 hours, stale** | "12086 hours" (live sentence) ✓ |
| P10 to P90 coverage, day-ahead | 78.5% | 78.5% ✓ | 78.5% ✓ | 78.5% ✓ | **79.9% (shown as 80%), stale** | live token ✓ |
| Load / wind / system price MAE | 1,211 / 2,113 / 43.4; coverage 80.5 / 76.3 / 76.6% | ✓ | ✓ | not quoted | not shown | not shown |
| Replay 26 Oct coverage | 78 of 168 (46%), `/replay` | 78 / 46% ✓ | 78 / 46% ✓ | 78 / 46% ✓ | 78 of 168 ✓ (same file) | computed from `/replay` ✓ |
| Replay 2 Nov coverage | 155 of 168 (92%), ordinary wind (#163) | not in README (row removed) | 155 / 92% ✓ | 155 / 92% ✓ | not shown | not shown |
| 26 Oct constraint cost | £36.5m (£36,530,869, NESO) | £36.5m ✓ | £36.5M ✓ | £36.5m; "£36M" in the g-research fallback note, rounded | £36.5m ✓ | £36.5m typed in `tour/numbers.js` and `unseen/cards.js` ✓ |
| 26 Oct ghost wind | 71.6 GWh accepted bids, 65.2 GWh in North Scotland | not quoted | "about 72 GWh" ✓ | 72 / 71.6 / 65.2 ✓ | not shown | live ✓ |
| Constraint costs, latest window | £205.4m over 11 published days (17 to 29 Oct) | not quoted | not quoted | not quoted | £205.4m ✓ | live ✓ |
| Forecasts scored live | 879 by 06:00, since 13:48 Saturday (rises hourly) | not quoted | 879, dated ✓ | 879, dated ✓ | **301, stale** (the slide says "live") | live token ✓ |
| Battery, share of perfect | 97.6% pooled, 5 zones, 155 hours (`/scores`) | not quoted | 97.6% ✓ | "about 98%" ✓ | **90.7%, stale** (pre-#246, 6 zones) | live token ✓ |
| Battery, naive rule | 87% to 89% per zone | not quoted | 87% to 89% ✓ | "under 90%" ✓ | not shown | live |
| Risk-aware against median-only | ahead in DE-LU, GB and NL; level in BE; behind in FR (98.6 vs 99.1%) | not quoted | not claimed ✓ | "as good or better in four of five" ✓ | not claimed ✓ | tour tokens ✓; caption text **mismatch**, see below |
| Hormuz cost, +40% gas for 14 days | £1.75bn (P10 £1.05bn, P90 £2.46bn); GB +£38.33 | not quoted | ✓ | ✓ | £1.75bn ✓ (unchanged since 21:29) | live token ✓ |
| Norway link trip | 980 MW for 24 h: GB +£3.92, £2.6M (P10 £1.5M, P90 £3.7M) | not quoted | ✓ | ✓ | not shown | live |
| Carbon, GB, 16:00 Saturday | 370 produced, 347 consumed, 7.5% imported | not quoted | 370 / 347 / 7% ✓ | ✓ | not checked (deck reads `/unseen/carbon` at its own hour) | live |
| Constants re-checked | 53 researched, 51 verified, 2 refused; 6 entered by hand | "51 of those pass" ✓ | ✓ (#330) | not quoted | not shown | not shown |
| Gas plant efficiency, carbon factor | 58%, 1.72 MWh gas per MWh; 0.334 t/MWh | ✓ | ✓ | ✓ | not shown | method note ✓ |

## Mismatches

1. **Deck (stefan, `demo/presentation/data/snapshot.json`):**
   - **The snapshot:** it was generated at 01:45 UTC. stefan-2's #282 branch (last commit 03:47) still has the same snapshot.
   - **Figures it gets wrong:** MAE (33.0 instead of 33.3), persistence (43.2 instead of 52.3), better than persistence (24% instead of 36%), hours (6,039 instead of 12,086), coverage (80% instead of 78.5%), battery (90.7% instead of 97.6%) and scored (301 instead of 879 and rising).
   - **Figures that still match:** the replay, Hormuz and constraint-cost figures. Re-snapshot just before the final render; nothing in `src/` is typed.
2. **README bot league (Keanu or lane A, `README.md` lines 149 to 170):**
   - **The section:** it describes a run "on 7 November at 20:57 UTC in an agent's worktree", over 43 days. The runner's `bot_league.parquet` of 02:07 covers the same 12 folds and 12,086 hours as the headline backtest, and on day-ahead prices it gives:

     | Model | MAE | Pinball | Inside P10 to P90 |
     |---|---|---|---|
     | Our model | **33.3** | **11.0** | 78.5% |
     | The Committee | 34.0 | 11.8 | 73.8% |
     | Yesterday | 36.7 | 13.1 | 76.2% |
     | The Engineer | 43.0 | 14.1 | 76.1% |
     | Last week | 55.5 | 19.1 | 68.9% |

   - **What changes:** the README says the Committee has the lowest overall pinball (11.5 against our 11.6). On the current file, our model leads the Committee on both MAE and pinball.
   - **The calm and storm columns:** they can't be re-derived from the parquet, which has no regime column.
   - **Fix:** re-run `python -m pipeline.bot_league` for the regime split, or label the table as the Saturday run and add the current totals.
3. **Tour caption (manu, `web/src/tour/chapters.js:72`):**
   - **The text:** "Shares are averaged over the six zones." NO2 is not scored, so the average is over five zones.
   - **The tokens:** `battery_risk` and `battery_median` are means over the five scored zones (97.6% and 97.2% now), so the numbers are right and only the word is wrong.
   - **Fix:** "five zones", or "the zones where perfect foresight made money".

## Smaller notes (no change needed)

- **Constraint cost for later replay days:**
  - **What happens:** `/replay` for 1, 2 and 6 November reports £36.0m, the brief's 26 October figure, because NESO hasn't published those days.
  - **Who sees it:** no screen shows it.
  - **Fix:** task #326.
- **The "£36M" in `g-research-first.md`'s fallback note** is the £36.5m figure rounded. A presenter saying it aloud would be consistent with the screen to within rounding.
- **Fixture mode:** in Fixture data mode, the bundled scenarios show Hormuz at about £752M and the Norway link at about £9.4M. `demo/scripts/README.md` now says to read them off the screen.
