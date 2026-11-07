"""python -m engine.publisher [--once] [--every 60] [--hours-back 48]

Republishes changed rows from the parquet cache into SpacetimeDB every minute.
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
from engine.publisher import Publisher, ReducerError, from_env, prune_before, sources

log = logging.getLogger("engine.publisher")


def run_once(pub: Publisher, hours_back: float, now: pd.Timestamp | None = None) -> dict[str, int]:
    now = now or pd.Timestamp.now(tz="UTC")
    cutoff = now - pd.Timedelta(hours=hours_back)
    sent = {"zones": pub.publish("zones", sources.zones())}
    for kind, df in (
        ("actuals", sources.actuals(cutoff)),
        ("forecasts", sources.forecasts(cutoff)),
        ("scores", sources.scores()),
        ("carbon", sources.carbon(cutoff)),
    ):
        if df is not None and len(df):
            sent[kind] = pub.publish(kind, df)
    gw = ghost_wind_costs.publish_rows(cutoff, now)
    if len(gw):
        sent["ghost_wind"] = pub.publish("ghost_wind", gw)
    bats, acts = battery_compare.battery_rows(battery_compare.run())
    if len(bats):
        sent["batteries"] = pub.publish("batteries", bats)
        acts = acts[pd.to_datetime(acts["ts"], utc=True) >= cutoff]
        if len(acts):
            sent["battery_actions"] = pub.publish("battery_actions", acts)
    prune_before(pub.client, cutoff - pd.Timedelta(hours=24))
    return sent


def main() -> None:
    ap = argparse.ArgumentParser(prog="python -m engine.publisher")
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--every", type=float, default=60.0, help="seconds between passes")
    ap.add_argument("--hours-back", type=float, default=48.0)
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")

    pub = Publisher(from_env())
    while True:
        try:
            log.info("published %s", run_once(pub, a.hours_back))
        except (ReducerError, httpx.HTTPError, OSError) as e:
            log.warning("publish pass failed: %s", e)
            if a.once:
                raise
        if a.once:
            return
        time.sleep(a.every)


if __name__ == "__main__":
    main()
