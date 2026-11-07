"""Hourly forecast run: refresh recent data, read features, predict, append to the forecast log.

    uv run python -m pipeline.scheduler          # loop, one run per hour
    uv run python -m pipeline.scheduler --once   # single run, for cron and tests

Uses the newest trained model under data/models/, or the stub when none exists. Only horizons after made_at are logged, and the log is append-only, so every row was written before its outcome.
"""

import argparse
import logging
import time

import pandas as pd

from pipeline import cache, commit_chain, features, forecast_log
from pipeline.ingest import boalf, carbon_intensity, elexon, energy_charts, markets, metered, neso, nordpool, octopus, open_meteo
from pipeline.models import quantile

log = logging.getLogger("pipeline.scheduler")

LOG_COLUMNS = ["made_at", "zone", "target", "ts", "horizon_h", "p10", "p50", "p90", "model_version"]
OFFSET_AFTER_HOUR_S = 120


def refresh(now: pd.Timestamp) -> list[str]:
    """Pull recent data from every source. A failing source is logged and does not stop the forecast."""
    if cache.offline():
        return []
    recent, ahead = now - pd.Timedelta(days=3), now + pd.Timedelta(days=2)
    jobs = {
        "elexon": lambda: elexon.run(recent, now),
        "energy_charts": lambda: energy_charts.fetch(recent, ahead),
        "nordpool": lambda: nordpool.run(recent, ahead),
        "markets": lambda: markets.run(now - pd.Timedelta(days=10)),
        "carbon_intensity": lambda: carbon_intensity.run(recent, now),
        "octopus": lambda: octopus.run(recent, ahead),
        "open_meteo_live": lambda: [open_meteo.write(open_meteo.fetch_live(now=now), "live_forecast")],
        # The unseen layer: wind bids (BOAV), metered wind (B1610 lags ~5 days, PN fills the gap), and NESO
        # constraint costs (~1 week late, so look back 3 weeks) and day-ahead boundary flows.
        "boalf": lambda: boalf.run(recent, now),
        "metered": lambda: metered.run(now - pd.Timedelta(days=7), now),
        "neso": lambda: neso.run(now - pd.Timedelta(days=21), ahead),
    }
    failed = []
    for name, job in jobs.items():
        try:
            job()
        except Exception:
            log.warning("refresh failed for %s; forecasting from what is cached", name, exc_info=True)
            failed.append(name)
    return failed


def to_log_rows(predicted: pd.DataFrame, made_at: pd.Timestamp, version: str) -> pd.DataFrame:
    """predicted is the long ts, zone, target, p10, p50, p90 frame from QuantileModel.predict_all."""
    df = predicted[predicted["ts"] > made_at].copy()
    df["made_at"] = made_at
    df["horizon_h"] = ((df["ts"] - made_at) / pd.Timedelta(hours=1)).round().astype("int32")
    df["model_version"] = version
    return df[LOG_COLUMNS]


def run_once(now=None, do_refresh: bool = True) -> int:
    """One forecast batch. Returns the number of log rows appended."""
    made_at = pd.Timestamp.now(tz="UTC") if now is None else pd.Timestamp(now)
    if made_at.tzinfo is None:
        made_at = made_at.tz_localize("UTC")
    if do_refresh:
        refresh(made_at)
    model = quantile.active()
    rows = to_log_rows(model.predict_all(features.latest()), made_at, model.version)
    if rows.empty:
        log.warning("no future feature rows after %s; nothing logged", made_at)
        return 0
    n = forecast_log.append(rows)
    log.info("logged %d forecasts made at %s", n, made_at)
    commit_chain.safely(commit_chain.commit_run, rows, made_at)
    return n


def _sleep_until_next_hour() -> None:
    now = pd.Timestamp.now(tz="UTC")
    target = now.floor("h") + pd.Timedelta(hours=1, seconds=OFFSET_AFTER_HOUR_S)
    time.sleep(max(1.0, (target - now).total_seconds()))


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--once", action="store_true", help="run a single batch and exit")
    ap.add_argument("--no-refresh", action="store_true", help="skip ingest and use cached data")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    while True:
        try:
            run_once(do_refresh=not args.no_refresh)
        except Exception:
            if args.once:
                raise
            log.exception("scheduler run failed; will retry next hour")
        if args.once:
            return
        _sleep_until_next_hour()


if __name__ == "__main__":
    main()
