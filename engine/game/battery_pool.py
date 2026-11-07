"""Load mystery days for battery rounds into the SpacetimeDB module.

    uv run python -m engine.game.battery_pool [--day 2026-10-26 | --all] [--dry-run]

For each replay day (data/replay/<day>.json) this sends battery_pool_put: the evening window's hourly GB system
prices (two half-hour slots per hour, as in engine.game.settle) and the plans of the two agents, made from the
as-of forecasts only (a median-only plan and a risk-aware plan). The module reveals each slot's price when it
settles and never sends the day or the plans to a client before then. Needs LG_STDB_URL / LG_STDB_TOKEN(_FILE).
"""

import argparse
import json
import logging
from datetime import date

import pandas as pd

from engine import replay
from engine.battery.optimiser import Battery, optimise
from engine.game.settle import GameBattery
from engine.publisher.client import from_env

log = logging.getLogger("engine.game.battery_pool")

TARGET = "gb_system_price"
START_HOUR, END_HOUR = 12, 21  # window [12:00, 21:00): 9 hours = 18 half-hour slots, about 3 minutes at 10 s a slot
WINDY_COST_GBP = 1_000_000  # no regime in the file: a day with this much constraint cost counts as windy


def regime(r: dict) -> str:
    if r.get("regime") in ("calm", "windy"):
        return r["regime"]
    return "windy" if (r.get("constraint_cost_gbp") or 0) >= WINDY_COST_GBP else "calm"


def window(r: dict, start_hour: int = START_HOUR, end_hour: int = END_HOUR) -> pd.DataFrame:
    series = next((s for s in r["series"] if s["zone"] == "GB" and s["target"] == TARGET), None)
    if series is None:
        raise ValueError(f"no GB {TARGET} series")
    df = pd.DataFrame(series["points"])
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    df = df[(df["ts"].dt.hour >= start_hour) & (df["ts"].dt.hour < end_hour)].sort_values("ts").reset_index(drop=True)
    if len(df) != end_hour - start_hour or df[["actual", "p10", "p50", "p90"]].isna().any().any():
        raise ValueError(f"need {end_hour - start_hour} complete hours between {start_hour}:00 and {end_hour}:00")
    return df


def payload(day: date, r: dict, start_hour: int = START_HOUR, end_hour: int = END_HOUR) -> list:
    """Arguments of battery_pool_put. The plans read only p10/p50/p90, never the actuals."""
    df = window(r, start_hour, end_hour)
    g = GameBattery()
    battery = Battery(power_mw=g.power_mw, energy_mwh=g.energy_mwh, round_trip=g.round_trip, degradation_per_mwh=g.degradation_per_mwh)
    forecast = df[["ts", "p10", "p50", "p90"]]
    plans = {}
    for name, mode in (("median_only", "median"), ("risk_aware", "risk_aware")):
        hourly = optimise(forecast, mode, battery, g.soc0_mwh)["action"].tolist()
        plans[name] = [a for a in hourly for _ in (0, 1)]
    prices = [float(p) for p in df["actual"] for _ in (0, 1)]
    return [day.isoformat(), regime(r), start_hour * 2, len(prices), json.dumps(prices), json.dumps(plans)]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--day", type=date.fromisoformat)
    ap.add_argument("--all", action="store_true", help="every day with a replay file")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    days = sorted(date.fromisoformat(p.stem) for p in replay.path(replay.HEADLINE_EVENT).parent.glob("*.json")) if args.all else [args.day or replay.HEADLINE_EVENT]
    client = None if args.dry_run else from_env()
    for d in days:
        r = replay.load(d)
        if r is None:
            log.warning("no replay for %s", d)
            continue
        try:
            args_ = payload(d, r)
        except ValueError as e:
            log.warning("skipping %s: %s", d, e)
            continue
        if client:
            client.call("battery_pool_put", *args_)
        log.info("battery pool: %s %s %d slots%s", d, args_[1], args_[3], " (dry run)" if client is None else "")


if __name__ == "__main__":
    main()
