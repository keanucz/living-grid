"""python -m engine.publisher [--once] [--every 60] [--hours-back 48]

Republishes changed rows from the parquet cache into SpacetimeDB every minute. On start it first reconciles:
rows in publisher-owned tables that the live sources would not produce (e.g. old sample rows) are deleted.
Configured by LG_STDB_URL (e.g. http://127.0.0.1:3000) and LG_STDB_DB (default living-grid).
With LG_OFFLINE=1 or no URL it only logs what it would send.
"""

import argparse
import logging
import time

import httpx
import pandas as pd

from engine.battery import compare as battery_compare
from engine.ghost_wind import costs as ghost_wind_costs
from engine.publisher import (
    Publisher,
    ReducerError,
    from_env,
    prune_before,
    reconcile,
    sources,
)

log = logging.getLogger("engine.publisher")


PRUNE_MARGIN = pd.Timedelta(hours=24)


def gather(now: pd.Timestamp, cutoff: pd.Timestamp) -> dict[str, pd.DataFrame | None]:
    """Every publisher-owned table's rows from the live sources, from `cutoff` on."""
    frames: dict[str, pd.DataFrame | None] = {
        "zones": sources.zones(),
        "actuals": sources.actuals(cutoff),
        "forecasts": sources.forecasts(cutoff),
        "scores": sources.scores(),
        "carbon": sources.carbon(cutoff),
    }
    frames["ghost_wind"] = ghost_wind_costs.publish_rows(cutoff, now)
    bats, acts = battery_compare.battery_rows(battery_compare.run())
    frames["batteries"] = bats
    frames["battery_actions"] = acts[pd.to_datetime(acts["ts"], utc=True) >= cutoff] if len(acts) else acts
    return frames


def run_once(pub: Publisher, hours_back: float, now: pd.Timestamp | None = None, reconcile_first: bool = False) -> dict[str, int]:
    now = now or pd.Timestamp.now(tz="UTC")
    cutoff = now - pd.Timedelta(hours=hours_back)
    frames = gather(now, cutoff)
    sent: dict[str, int] = {}
    if reconcile_first:
        # Expected set spans everything prune_before keeps, so reconciling never removes a row prune would keep.
        try:
            removed = reconcile(pub.client, gather(now, cutoff - PRUNE_MARGIN))
            sent["deleted"] = sum(removed.values())
        except (ReducerError, httpx.HTTPError) as e:  # e.g. module without delete_keys: still publish, retry next pass
            log.warning("reconcile failed, will retry next pass: %s", e)
            sent["reconcile_failed"] = 1
    for kind, df in frames.items():
        if df is not None and len(df):
            sent[kind] = pub.publish(kind, df)
    prune_before(pub.client, cutoff - PRUNE_MARGIN)
    return sent


def main() -> None:
    ap = argparse.ArgumentParser(prog="python -m engine.publisher")
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--every", type=float, default=60.0, help="seconds between passes")
    ap.add_argument("--hours-back", type=float, default=48.0)
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")

    pub = Publisher(from_env())
    first = True
    while True:
        try:
            sent = run_once(pub, a.hours_back, reconcile_first=first)
            log.info("published %s", sent)
            first = "reconcile_failed" in sent
        except (ReducerError, httpx.HTTPError, OSError) as e:
            log.warning("publish pass failed: %s", e)
            if a.once:
                raise
        if a.once:
            return
        time.sleep(a.every)


if __name__ == "__main__":
    main()
