# Weather v2 (#220): data side

Status: the data side is done and stands alone. It is not wired into the features, the scheduler, the explanations or
any model, so the live model (lgbm-202611072046) is unchanged. **The retrain comparison has not been run**: it was
started and stopped part-way on 8 Nov (server load) and produced no saved result. Rerun it with the command at the end.

## What is ingested (pipeline/ingest/weather_v2.py)

21 locations: 10 population centres (London, Birmingham, Manchester, Glasgow, Paris, Berlin, Amsterdam, Brussels, Oslo,
Stavanger; Oslo is in NO1, which we do not model, so Stavanger stands in for NO2) and the 11 Scottish wind farms in
data/static/wind_farms.csv. Variables: 100 m wind, 10 m gusts, cloud cover, precipitation, 2 m temperature.

| Kind | API | Covers | What it is |
|---|---|---|---|
| archive | archive-api (ERA5 reanalysis) | any past day, 5 days behind | what the weather turned out to be; a reanalysis, not a station measurement |
| historical_forecast | historical-forecast-api | from 2022 | stitched first hours of each model run; forecast-like, the one to train on |
| previous_day1 | previous-runs-api | from Jan 2024 | the forecast that existed 24 h before each hour, but only temperature, precipitation, cloud cover and 10 m wind (no gusts, no 100 m wind) |
| live_forecast | forecast API | next days | with issued_at, every run kept |
| ensemble | ensemble-api, ECMWF IFS 0.25 (51 members) | next days | per hour mean, std, p10, p90, member count and the share of members beyond an alert threshold |

Pulled on 8 Nov 2026 (21 locations, hourly, no gaps): archive and historical_forecast 2025-01-01 to 2026-11-07
(1.70m rows each), previous_day1 2026-01-01 to 2026-11-07 (627k rows). Archive and historical-forecast gusts correlate at
0.91. The files are in data/weather_v2/ in the stefan-4 worktree (git-ignored); the runner does not have them yet.

Ensembles cannot be backfilled: Open-Meteo keeps individual members for about 3 days (its Ensemble Mean API keeps mean and
spread, mostly from March 2026). So ensembles can inform live and mystery-day probabilities from now on but cannot be
a trained model feature until enough runs have accrued. The previous_day1 kind is the honest "forecast that existed then"
for mystery days; the historical_forecast kind is closer to an analysis.

## Open-Meteo limits (checked on their terms and docs pages)

Free tier: under 10,000 calls a day, 5,000 an hour, 600 a minute; non-commercial; CC BY 4.0 (credit Open-Meteo.com).
A multi-location request counts each location, and a range over 2 weeks or 10 variables counts as more than one call.
The scheduled weather grid (about 1,700 points every 6 h) is already about 6,900 calls a day, so v2 history is pulled once
by hand (run_history) and only the cheap live part (run: live forecast and ensemble, 21 locations) is meant for the
scheduler.

## Official warnings history: not openly available

- Met Office NSWWS: the machine-readable feed needs an API key and serves current warnings only (updates persist 24 h). The
  history is a catalogue of PDFs in the Met Office digital archive (back to March 2011), not a bulk dataset.
- MeteoAlarm: no open history archive found in the sources checked; treat it as unavailable.

So alerts are our own definition, labelled as such: an hour is an alert when it is beyond that location's 99th percentile
(gusts, rain) or 1st percentile (cold) over the archive data (alert_thresholds, alert). They are not official warnings.
Example thresholds: Glasgow gust 19.2 m/s, Paris gust 15.6 m/s, Seagreen wind farm gust 24.6 m/s; Glasgow cold below
-1.9 C.

## Candidate model features (not live)

pipeline.experiments.weather_v2_backtest adds these zone-level columns from the historical_forecast kind: gust_max_ms,
cloud_mean_pct, precip_mm, wind_100m_farm_ms (GB only), alert_gust_share, alert_rain_share. It runs pipeline.backtest
twice on identical rows and folds (current features versus current plus these) and reports MAE, pinball loss and coverage
per target and zone, wins and losses alike. Nothing goes live until that comparison is read and a later task adds the
columns to schemas.FEATURE_COLUMNS, the feature build, the scheduler and the explanation groups.

    uv run python -m pipeline.experiments.weather_v2_backtest --data-dir <dir with the caches and weather_v2> \
        --since 2025-01-01 --folds 6 --test-days 7 --n-jobs 2     # run under nice -n 10, one heavy job at a time
