# Where the model loses to the baselines: FR wind, NL load, NO2 price

Task #162. This is a read-only investigation: nothing in the model or pipeline changed. Written 7 November 2026, 22:45 UTC.

## Summary

| Case | Model MAE | Best baseline MAE | Cause | Smallest fix after the demo |
|---|---|---|---|---|
| FR wind | 2,967 MW | persistence 2,442 MW | One of FR's two weather points, Rhône, does not track French wind output. Averaging it in destroys the main wind feature. | Use only the Paris point for FR wind features. In a re-run this cuts MAE to **1,385 MW**, 44% better than persistence and better in every fold. |
| NL load | 1,224 MW | yesterday 945 MW | A break in the Energy-Charts NL load series on 10 October 2026: load drops about 27% and gains a solar-shaped midday dip. One test week after the break accounts for the whole loss. | Check the source. Then either rebuild NL load history on one definition, or train NL only after the break. Without that fold the model already wins (803 MW against 887 MW). |
| NO2 price | €22.7/MWh | persistence €22.5/MWh | NO2 prices are sticky (hydro water values), and the model gets the daily level wrong. It has no last-known-price feature, and the pooled model moves NO2's level with gas. | Add a last-known-value feature, which helps every target and brings NO2 to €22.3 (persistence €22.0). Then give NO2 its own level model or drop the gas features for NO2. |

Hypothesis 1 from the brief ("persistence wins at short horizons") is only partly true. The backtest scores a single 12-hour lead, and FR wind loses even there. The real cause is the weather feature, not the horizon.

## Data and method

- **Backtest file:** `data/backtest/walk_forward.parquet` on the runner (written 16:53 UTC). It covers six purged weekly folds at the 12-hour lead (`build.HISTORY_LEAD_H = 12`). The MAEs in the summary table above come from this file, n-weighted over the folds.
- **Per-row re-run:** the file stores only fold aggregates. I re-ran the same walk-forward at 22:00 UTC from runner data, with the same functions (`backtest.make_folds`, `train.fit_target`, `backtest.baselines`) and median predictions kept per row. Its folds start one day later than the file's, because the history now reaches 8 November 16:00 UTC. It reproduces all three losses:

  | Case | Model | Persistence | Yesterday |
  |---|---|---|---|
  | FR wind | 2,886 MW | 2,454 MW | 3,162 MW |
  | NL load | 1,262 MW | 1,680 MW | 953 MW |
  | NO2 price | €23.3 | €22.0 | €22.9 |

  The tables below use this re-run.
- **Calibration:** MAE uses the median (P50), which conformal calibration does not change, so the re-run is uncalibrated.
- **Counterfactuals:** two scratch experiments, each retraining only the median model with one input changed. Fold boundaries and LightGBM parameters stay the same, with `n_jobs` 2 and `nice -n 19`. Both are evidence for a fix, not a fix.

## 1. FR wind: one weather point does not track French wind

The wind model's strongest feature is `wind_gen_fc_mw` (25% of gain): the mean wind speed over a zone's Open-Meteo points, put through a generic power curve, times capacity. FR has two points, `paris` (48.85, 2.35) and `rhone` (44.0, 4.8). Hourly correlation of each with FR wind output (onshore plus offshore, November 2025 to November 2026):

| Zone | Points | Each point | Mean speed | Power curve of mean |
|---|---|---|---|---|
| FR | paris, rhone | paris **0.83**, rhone **0.01** | 0.40 | 0.30 |
| DE-LU | hamburg, munich | hamburg 0.79, munich 0.41 | 0.76 | 0.59 |
| NL | amsterdam, north_sea | 0.79, 0.81 | 0.86 | 0.86 |
| BE | brussels | 0.80 | 0.80 | 0.72 |

The Rhône point sits in the mistral corridor. Its wind is uncorrelated with Paris (r = −0.04) and with France's wind fleet, which is mostly in the north and north-east, plus Atlantic offshore. Averaging it in more than halves the feature's correlation.

**Where it fails.** In fold 3 (18–25 October, a windy week) the model's MAE was 6,461 MW against persistence at 2,981 MW. Daily means for that week:

| Day | Actual MW | Model P50 MW | `wind_gen_fc_mw` | Paris m/s | Rhône m/s |
|---|---|---|---|---|---|
| 21 Oct | 13,574 | 5,031 | 5,213 | 9.0 | 8.2 |
| 23 Oct | 17,365 | 8,558 | 11,778 | 14.8 | 6.6 |
| 25 Oct | 17,391 | 5,723 | 2,640 | 13.3 | 1.2 |

On 25 October Paris had 13.3 m/s but a calm Rhône pulled the average down, so the feature said 2.6 GW while 17.4 GW was flowing. Across all folds the model under-forecasts hours above 10 GW by 7,135 MW on average and over-forecasts hours below 3 GW by 1,915 MW. That is the shrink-to-the-middle pattern of a weak feature. Without fold 3 the model already wins: 2,152 MW against persistence at 2,346 MW.

**Counterfactual: Paris point only** (`wind_speed_100m` and `wind_gen_fc_mw` for FR from Paris alone; capacity as before):

| Fold | Current | Paris only | Persistence | Yesterday |
|---|---|---|---|---|
| 0 | 1,620 | 1,359 | 1,929 | 2,358 |
| 1 | 2,324 | 1,382 | 3,280 | 3,950 |
| 2 | 1,965 | 1,368 | 2,135 | 2,778 |
| 3 | 6,461 | 1,649 | 2,981 | 4,164 |
| 4 | 1,935 | 1,080 | 2,503 | 3,040 |
| 5 | 3,027 | 1,482 | 1,815 | 2,611 |
| **All (MW)** | **2,886** | **1,385** | **2,454** | **3,162** |

The other zones are unchanged or slightly better: GB 2,023 → 1,932, BE 618 → 604, NL 756 → 748 and DE-LU 4,643 → 4,641 MW.

**Horizon (hypothesis 1).** FR wind persistence error grows quickly with lead time:

| Lead time | 1 h | 3 h | 6 h | 12 h | 24 h | 36 h | 48 h |
|---|---|---|---|---|---|---|---|
| Persistence MAE (MW) | 662 | 1,144 | 1,723 | 2,478 | 3,299 | 3,794 | 4,394 |

So even today's model (about 2,900 MW at 12 h) beats persistence beyond roughly 18 h, and persistence wins below that. The scoreboard compares at the 12-hour lead, where the weak feature makes the model lose.

The live forecast log so far covers only about 8 hours of `made_at`, too little to score by horizon.

**Smallest fix:** in `pipeline/features/build.py`, build FR wind features from the Paris point only, or from the mean of power curves over points weighted by nearby capacity. No new ingest is needed. Better still, after the demo: add one or two Open-Meteo points where France's wind fleet sits, such as Hauts-de-France around 50.3, 2.8 and Grand Est around 48.8, 4.5. That needs a history pull.

## 2. NL load: a break in the source series on 10 October

Energy-Charts NL load, daily means (MW):

| Window | Mean MW |
|---|---|
| 26 Sep – 9 Oct 2026 | 13,600 |
| 10 Oct – 23 Oct 2026 | 9,950 |
| Same two windows in 2025 | 13,125 → 13,457 (no drop) |
| BE, FR and DE-LU across the 2026 break | all rose 2–8% |

Hourly profile before and after the break:

| Hour (UTC) | 03 | 08 | 11 | 12 | 17 |
|---|---|---|---|---|---|
| Before (MW) | 11,442 | 14,134 | 14,326 | 14,161 | 15,267 |
| After (MW) | 9,703 | 9,916 | 8,290 | 8,112 | 11,084 |

After 10 October the series has a deep midday trough, which looks like load net of behind-the-meter solar. Night load also fell by about 1.7 GW. Real Dutch demand does not fall 27% overnight, so this looks like a change of definition or source in the Energy-Charts NL load series. I have not confirmed it against the source. Energy-Charts' NL solar series is also implausibly small, peaking near 200 MW for a country with over 25 GW of solar, so it cannot be used to reconstruct the series.

**Effect on the backtest.** The model's main load feature is `load_fc_mw` (load 168 h earlier; 65% of gain), and its trees learned two years at the old level. NL by fold in the re-run:

| Fold | Test week | Model | Yesterday | Model bias | Raw P10–P90 coverage |
|---|---|---|---|---|---|
| 0 | 27 Sep | 324 | 789 | −240 | 72% |
| 1 | 4 Oct | 1,057 | 1,406 | +651 | 61% |
| 2 | 11 Oct (break) | **3,497** | 1,275 | **+3,397** | **10%** |
| 3 | 18 Oct | 991 | 937 | +866 | 83% |
| 4 | 25 Oct | 988 | 689 | −716 | 58% |
| 5 | 1 Nov | 636 | 575 | −2 | 77% |

Without fold 2 the model wins: 803 MW against yesterday at 887 MW. After the break the model still loses at night, for example 719 against 579 MW in fold 3, while it roughly matches "yesterday" at midday. Its trees still pull towards the old level.

**Smallest fix:** first confirm the definition change on energy-charts.info, or against ENTSO-E actual total load if a key is set. Then either:
- re-pull NL load history on the new definition, or
- train NL load only on rows from 10 October 2026 onwards.

Until then, NL load's scoreboard line should carry a note.

## 3. NO2 price: the model gets the sticky level wrong

NO2 is hydro-dominated. Its price follows water values, so it moves within the day far less than the continent:

| Zone | Mean daily range (€/MWh) | Persistence MAE at 12 h | Yesterday MAE |
|---|---|---|---|
| NO2 | 62.7 | 22.7 | 22.8 |
| FR | 163.5 | 53.1 | 40.7 |
| NL | 158.2 | 51.3 | 41.7 |
| DE-LU | 152.7 | 49.7 | 41.6 |
| BE | 151.9 | 49.7 | 39.0 |

Persistence therefore sets an unusually low bar in NO2. To see where each forecast goes wrong, NO2's absolute error is split into two parts:
- **daily level:** the error of each day's mean price;
- **intraday shape:** the error in each hour's deviation from that daily mean.

| Error part | Model | Persistence | Yesterday |
|---|---|---|---|
| Daily level | 19.6 | **10.8** | 18.2 |
| Intraday shape | **13.6** | 20.0 | 15.2 |
| MAE | 23.3 | 22.0 | 22.9 |

The model gets the shape right and the level wrong. Two reasons:

1. **No last-known value.** The features have the target's 24 h and 168 h lags, but never the last value known at the forecast origin, which is exactly what persistence uses. This affects every target.
2. **The pooled model moves NO2's level with gas.** One price model is shared by all zones, with `zone_id` as a category. In fold 3 (18–25 October), TTF averaged €88.8 (up from €85.3 the week before) while NO2 averaged €130, down from €152.5. The model forecast €162.5, an average bias of +€32.5.

**Counterfactual: add a last-known-value feature** (the target's value at the forecast origin minus 1 h, the same value persistence uses), for all targets:

| Case | Current | + last-known | Persistence | Yesterday |
|---|---|---|---|---|
| NO2 price | 23.3 | 22.3 | 22.0 | 22.9 |
| NL load | 1,262 | 1,150 | 1,680 | 953 |
| FR wind | 2,886 | 2,286 | 2,454 | 3,162 |
| DE-LU wind | 4,643 | 4,094 | 6,416 | 8,333 |
| FR load | 1,918 | 1,654 | 6,630 | 2,292 |
| NL price | 34.9 | 33.5 | 50.1 | 41.9 |

The feature helps 15 of the 16 target-zone pairs (only BE load is slightly worse, 311 → 315 MW), and it alone turns FR wind into a win. Over the six folds, NO2 moves from losing by €1.3 to losing by €0.3. Fold 3 still loses: €36.3 against persistence at €28.0, because the gas-driven level error remains.

**Smallest fix:**
1. Add a last-known-value feature, with `hours_ahead`, because the live model forecasts 0–48 h ahead and the value matters less at long leads. This changes `schemas.FEATURE_COLUMNS`, a shared contract.
2. Then, for NO2 only, either drop the gas and EUA features or fit a separate NO2 model.

NO2's wind and load targets were removed on purpose: Energy-Charts' Norway series cover the whole country, not NO2. That is not the cause here, because those are targets, not price features.

## Recommended order after the demo

1. **FR wind: Paris point only.** A one-line change in `features/build.py` with the largest gain (−1,500 MW MAE).
2. **NL load: confirm the 10 October break,** then re-pull or cut the training window. Until then, flag NL load on the scoreboard.
3. **Last-known-value feature.** This touches the feature contract, so it needs the team's agreement.
4. **NO2 price:** a separate level model, or no gas features for NO2.

The scratch scripts that produced these numbers are not committed. They call `backtest.make_folds`, `train.fit_target` and `backtest.baselines` against `/srv/hack/runner/data`, and can be re-created from the method above.
