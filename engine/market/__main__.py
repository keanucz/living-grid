"""Run one mystery-day market round in SpacetimeDB.

    uv run python -m engine.market [--day 2026-10-26] [--start 12] [--end 18] [--seconds 30] [--dry-run]

Starts a round with questions from data/replay/<day>.json, lets the model trade, then advances the clock one
game hour every --seconds, posting what happened in each hour and settling questions as their hour passes.
Needs LG_STDB_URL / LG_STDB_TOKEN(_FILE) (an admin identity); --dry-run prints the questions instead.
"""

import argparse
import json
import logging
import time
from datetime import date

from engine import replay
from engine.market import botdata, lmsr, questions
from engine.publisher.client import Client, from_env
from pipeline import cache

log = logging.getLogger("engine.market")


def boalf_gb():
    try:
        b = cache.read("actuals/elexon_boalf_mwh")
    except FileNotFoundError:
        return None
    return b[b["zone"] == "GB"][["ts", "value"]]


def plan(day: date, start_hour: int, end_hour: int, league: bool = False) -> tuple[dict, list[questions.MarketQuestion], object]:
    r = replay.load(day)
    if r is None:
        raise SystemExit(f"no replay for {day}: run python -m engine.replay {day} first")
    b = boalf_gb()
    bots = botdata.load(day) if league else None
    if league and bots is None:
        raise SystemExit(f"no bot quantiles for {day}: run python -m engine.market.botdata --day {day} first")
    return r, questions.build(r, b, end_hour, start_hour, league=bots), b


def start_args(qs: list[questions.MarketQuestion], start: int, end: int, seconds: int, day: date, league: bool = False) -> list:
    """market_start arguments. league=True sends the bot league's fields too: only for a module that accepts them (#140)."""
    return [questions.TITLE, lmsr.B, start, end, seconds,
            [(questions.league_public if league else questions.public)(q) for q in qs],
            [{"question_id": q.id, "outcome": q.outcome, "actual": q.actual} for q in qs],
            day.isoformat()]


def run(client: Client | None, day: date, start: int, end: int, seconds: int, sleep=time.sleep, league: bool = False) -> list[str]:
    if end <= start:
        raise SystemExit(f"--end ({end}) must be after --start ({start})")
    r, qs, b = plan(day, start, end, league=True) if league else plan(day, start, end)
    qs = [q for q in qs if q.target_hour > start]  # the module refuses trades on a question whose hour has passed
    if not qs:
        raise SystemExit("no questions could be built for that day")
    if client is None:
        print(json.dumps([(questions.league_public if league else questions.public)(q) for q in qs], indent=2))
        return [q.id for q in qs]
    client.call("market_start", *start_args(qs, start, end, seconds, day, league))
    log.info("market: round started with %d questions", len(qs))
    for hour in range(start + 1, end + 2):
        sleep(seconds)
        client.call("market_tick", hour, questions.feed(r, b, hour - 1))
        log.info("market: clock %02d:00", hour)
    return [q.id for q in qs]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--day", type=date.fromisoformat, default=replay.HEADLINE_EVENT)
    ap.add_argument("--start", type=int, default=12)
    ap.add_argument("--end", type=int, default=18)
    ap.add_argument("--seconds", type=int, default=30)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--league", action="store_true", help="send the bot league's probabilities too (needs the module from #140)")
    ap.add_argument("--reset", action="store_true", help="clear the round and every account (hides a revealed day)")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    if args.reset:
        from_env().call("market_reset")
        log.info("market: round cleared")
        return
    run(None if args.dry_run else from_env(), args.day, args.start, args.end, args.seconds, league=args.league)


if __name__ == "__main__":
    main()
