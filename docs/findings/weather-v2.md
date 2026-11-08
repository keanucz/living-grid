# Weather v2: does it help the models? (#227)

**Result.** Adding six zone-level weather v2 columns lowered the walk-forward error of all four targets, by a lot for wind (-14.7% MAE) and a little for load (-1.4%). It is a candidate, not live: nothing was retrained or published, and the live model (`lgbm-202611072046` recipe) is unchanged.

## What was compared

Two runs of `pipeline.backtest` on identical rows, folds and parameters:

- **base**: the live feature set (`schemas.FEATURE_COLUMNS`), the recipe of the live model.
- **v2**: the live features plus `gust_max_ms`, `cloud_mean_pct`, `precip_mm`, `wind_100m_farm_ms`, `alert_gust_share`, `alert_rain_share` per zone and hour. They come from the Open-Meteo *historical-forecast* kind (a forecast-like number, as the live features are), never from the archive. The alert shares use per-site thresholds computed from the archive.

Command (one run, 07:07 to 07:26 UTC on 8 Nov 2026, about 9 to 10 minutes per variant):

```
nice -n 10 uv run python -m pipeline.experiments.weather_v2_backtest --data-dir <copy of runner caches + weather_v2> \
    --since 2025-01-01 --folds 6 --test-days 7 --n-jobs 2
```

Data: runner caches copied from `/srv/hack/runner/data` plus stefan-4's `weather_v2` pulls (`historical_forecast`, `archive`, `previous_day1`, hourly from 1 Jan 2025 to 7 Nov 2026). Features start 1 Jan 2025. Six weekly test folds, each trained only on data before it, covering 27 Sep to 7 Nov 2026 (the last fold trains to 30 Oct). The quantile spread is calibrated per fold on held-out training rows, as in the live backtest. Raw output: `weather_v2/…` comparison parquet (`backtest/weather_v2_comparison`).

Change is v2 against base; **negative is better**. MAE is in €/£ per MWh for prices and MW for load and wind. Pinball is the average over the P10, P50 and P90 quantiles.

## Headline per target

| target | MAE change | pinball change | zones better (pinball) |
|---|---|---|---|
| wind | -14.7% | -13.7% | 5 of 5 |
| price_da | -5.6% | -4.8% | 5 of 6 |
| gb_system_price | -3.0% | -1.5% | 1 of 1 |
| load | -1.4% | -0.0% | 2 of 5 |

## Per target and zone

| target | zone | n | MAE base | MAE v2 | change | pinball change | P10 to P90 coverage base / v2 |
|---|---|---|---|---|---|---|---|
| gb_system_price | GB | 992 | 44.96 | 43.60 | -3.0% | -1.5% | 75% / 75% |
| load | BE | 990 | 333.92 | 325.04 | -2.7% | +0.7% | 85% / 84% |
| load | DE-LU | 991 | 1832.35 | 1826.46 | -0.3% | +2.4% | 84% / 79% |
| load | FR | 990 | 2120.17 | 2083.92 | -1.7% | -1.6% | 77% / 78% |
| load | GB | 992 | 1747.94 | 1690.53 | -3.3% | -3.3% | 82% / 79% |
| load | NL | 990 | 1238.28 | 1241.85 | +0.3% | +2.5% | 71% / 67% |
| price_da | BE | 1008 | 34.02 | 32.11 | -5.6% | -4.4% | 75% / 70% |
| price_da | DE-LU | 1008 | 35.33 | 33.98 | -3.8% | -3.0% | 74% / 70% |
| price_da | FR | 1008 | 41.15 | 37.16 | -9.7% | -10.8% | 74% / 71% |
| price_da | GB | 1008 | 24.95 | 25.43 | +1.9% | +0.6% | 85% / 84% |
| price_da | NL | 1008 | 36.88 | 34.57 | -6.3% | -5.1% | 70% / 67% |
| price_da | NO2 | 1008 | 23.39 | 21.53 | -8.0% | -3.8% | 81% / 80% |
| wind | BE | 990 | 661.93 | 533.86 | -19.3% | -18.0% | 70% / 76% |
| wind | DE-LU | 991 | 4730.66 | 4812.99 | +1.7% | -1.4% | 78% / 77% |
| wind | FR | 990 | 2918.84 | 1570.76 | -46.2% | -40.6% | 78% / 79% |
| wind | GB | 992 | 2101.53 | 2010.22 | -4.3% | -3.0% | 75% / 70% |
| wind | NL | 990 | 813.71 | 649.29 | -20.2% | -17.6% | 69% / 72% |

## Wins and losses

- **Wins:** wind in BE, FR and NL (-19% to -46%), and day-ahead price in FR, NO2, NL and BE (-6% to -10% MAE).
- **Small wins:** GB system price, GB load, FR load, GB wind.
- **Losses:** day-ahead price in GB (+1.9% MAE), wind in DE-LU (+1.7% MAE, pinball slightly better), load in NL (+0.3%). DE-LU and NL load, and BE load on pinball, are worse or flat on pinball.
- **Interval coverage:** after calibration, P10 to P90 coverage for day-ahead price fell by 1 to 5 points in five zones (from 70 to 85% down to 67 to 84%; overall 76.6% to 73.7%), and load fell 2 points overall. The target is 80%, so these intervals are narrower than they should be in both variants; v2 makes the price intervals slightly worse.

## Caveats

- **Short window.** Six weekly test folds, 27 Sep to 7 Nov 2026 (autumn, including the 26 Oct storm period). No winter or summer, no significance test, one seed. The FR wind result (-46%) is large enough to check before believing: `base` FR wind MAE of 2919 MW looks high next to the other zones and may be a weakness in the live recipe that any extra weather column fixes.
- **No ablation.** All six columns were added together. We do not know which one carries the gain.
- **Train and serve mismatch.** The model is trained on historical-forecast values. At serve time it would get the live forecast (`weather_v2.fetch_live`), which is the same kind of number but is not the same product as a stored past forecast; the live feature path has the same limitation today.
- **Alert thresholds** come from the archive history of each site, so they use the whole sample including the test weeks (a small leak in a threshold, not in a value).
- **Not tested:** the explanations, the explanation groupings and the scheduler. The feature columns would need to be added to schemas, features, scheduler and explanations in a separate task.

## What going live would need

1. **Ingest on the runner.** `/srv/hack/runner/data` has no `weather_v2` directory today, and `pipeline/scheduler.py` does not call `weather_v2.run`. The pulls exist only in stefan-4's worktree (`data/weather_v2`, ending 7 Nov 23:00 UTC). So: schedule `weather_v2.run` (live forecast and ensemble, cheap) hourly, and copy the three history files over once. Do not schedule the history pulls (Open-Meteo 10k calls a day per IP). The historical-forecast file also needs topping up daily so training features do not end at 7 Nov.
2. **Feature columns.** Six new columns on top of the current set: `gust_max_ms`, `cloud_mean_pct`, `precip_mm`, `wind_100m_farm_ms`, `alert_gust_share`, `alert_rain_share`, in `schemas`, `features.build` (history and latest), and the explanation groups.
3. **Retrain.** The routine VPS retrain (`run-train.sh`) took about 5.5 minutes on 8 Nov (05:35 to 05:41 UTC, `lgbm-202611080535`). A v2 retrain should take about the same, a little longer for the extra columns.
4. **Decision for Stefan.** Because the live path and the explanations change, going live is a separate task and Stefan's call. If the gain is wanted only for wind and day-ahead price, the other two targets could keep the current features.
