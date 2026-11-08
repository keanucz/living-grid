# The 2 November replay and its coverage

Task #163. Generated 8 November 2026, 07:08 to 07:14 UTC, under `nice -n 19` with 2 threads.

## What was done

- **New as-of model `asof-20261102`.** It is trained only on data before 2 November 00:00 UTC; every target's training window ends at 1 November 23:00. It has the #92 calibration. It came from `pipeline.models.asof.as_of("2026-11-02")` in a scratch data root that reads the runner's cached inputs. Nothing was retrained on the runner.
- **New replay file `data/replay/2026-11-02.json`.** Written by `engine.replay.run` and copied to the runner's `data/replay/`. It passes the replay-point checks in `pipeline.replay_days.check_day`: every point is inside the day, every forecast was made 12 hours ahead, and the quantiles are ordered. There is no `.bots.json`, so 2 November is not a Market day.
- **Live:** `GET /api/replay?event=2026-11-02` now serves it (it returned 404 before). The web app is unchanged: the Replay view shows only 26 October, and the Market view reads only the title.

## Coverage

**155 of 168 hours (92%)** landed inside the P10 to P90 band: 7 price series, 24 hours each.

| Series | Inside, calibrated | Inside, raw band | Above P90 | Below P10 | MAE |
|---|---|---|---|---|---|
| GB system price | 21 / 24 | 13 | 3 | 0 | 35.2 |
| GB day-ahead | 22 / 24 | 14 | 1 | 1 | 17.0 |
| FR day-ahead | 24 / 24 | 24 | 0 | 0 | 15.5 |
| DE-LU day-ahead | 18 / 24 | 15 | 2 | 4 | 26.6 |
| NL day-ahead | 23 / 24 | 21 | 1 | 0 | 18.9 |
| BE day-ahead | 23 / 24 | 15 | 0 | 1 | 30.0 |
| NO2 day-ahead | 24 / 24 | 21 | 0 | 0 | 8.3 |
| **All** | **155 / 168 (92%)** | **123 (73%)** | 7 | 6 | |

"Raw band" is the same model with the calibration scale removed (scales: day-ahead 1.56, system price 1.85).

## The README's 136 of 168 (81%) has nothing behind it now

- **No file to check it against.** The README row dates from #93, before #92 calibration. No 2 November file existed on the runner until this one, so 81% can't be reproduced. Neither the raw band of today's model (123, 73%) nor the calibrated one (155, 92%) gives it.
- **2 November was not a calm day.**
  - **The data:** GB wind averaged 9.5 GW, exactly the median of the last six weeks (22nd of 42 days, median 9.3 GW).
  - **The real calm days:** the days `replay_days` picks as calm are 29 and 31 October and 1 and 6 November, at 2.7 to 4.4 GW.
  - **Wording:** "an ordinary day" fits. "Calm" doesn't.
- **The 26 October row in the README (83 of 168) is also stale.**
  - **Live figure:** the 26 October file serves 78 of 168 (46%).
  - **Why it differs:** its model, `asof-20261026`, was trained at 16:13 Saturday, before #92, and has no calibration. Every other as-of model was retrained at about 00:10 Sunday with it.

## Why 92% and not 80%

1. **Calibration does what it says, on its own week.**
   - **How it works:** #92 fits one widening scale per target on the latest held-out week, so that 80% of that week lands inside the band.
   - **This model's week:** 25 October to 1 November, where the scale took coverage from 36% to 80.1% on day-ahead prices.
   - **Verdict:** the as-of model does include #92 calibration, and on that week it is on target.
2. **That week had the storm in it.**
   - **What drove the scale:** 26 and 27 October produced the misses the scale was fitted to.
   - **What that does to an ordinary day:** the same scale applied to 2 November makes the bands wider than that day needs. Mean band widths were €108 to €144/MWh on the continental zones and £148/MWh on system price.
   - **The other replays:** each was calibrated on a week that includes the storm. They land at 92% to 95%: 29 October 93%, 31 October 92%, 1 November 93%, 6 November 95%.
3. **One day is a small, correlated sample.**
   - **What 168 hours would give if independent:** 134 inside, give or take 5. On that basis 155 would be 4 standard deviations high.
   - **Why it is fewer:** hours within a day move together, and so do zones (FR, NL and BE are coupled), so there are far fewer than 168 independent hours. A single day well above 80% is not evidence of miscalibration.
   - **The test that counts:** the 12-fold backtest, at 78.5% over 12,086 hours.

**Plain version for judges:** on an ordinary day, after a week that contained a storm, the band is cautious and catches more than 8 hours in 10. The storm itself (46%) is the day it was too sure.

## Follow-ups (not changed here)

- **README Results (`README.md`, held by keanu-2 in #315):**
  - The table should read "2 November 2026 (ordinary wind): 155 of 168 (92%)" and "26 October 2026 (storm): 78 of 168 (46%)".
  - The sentence "Recalibrating the bands is in progress" is out of date: #92 shipped.
  - The paragraph above the table still says 63% for the backtest, where the current file gives 78.5%.
- **Constraint cost on days without NESO data (`engine/replay.py` `constraint_cost`):**
  - **Live today:** any day after NESO's last published day (29 October) gets the brief's £36.0m for 26 October, labelled as the brief's figure. The 1, 2 and 6 November files carry it.
  - **Who sees it:** no screen shows it (the Replay view only loads 26 October), but the API does.
  - **Fix:** use the brief's figure only for the headline event; otherwise return no figure and say none is published yet.
