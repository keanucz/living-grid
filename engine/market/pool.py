"""Load the mystery days into the module's private day pool, so a lobby can draw one without the engine.

    uv run python -m engine.market load-days [--days 2026-10-26 ...] [--start 12] [--end 18] [--dry-run] [--allow-no-bots]

Each day comes from data/replay/<day>.json (as-of forecasts and actuals) and <day>.bots.json (the bot league's
as-of quantiles). A day is only loaded when pipeline.replay_days.check_day finds both files sound. Calls the admin
reducer pool_put, which replaces a day that is already there; the day stays private until a round ends.
Needs LG_STDB_URL / LG_STDB_TOKEN(_FILE) like engine.market.
"""

import argparse
import json
import logging
import sys
from datetime import date

import pandas as pd

from engine import replay
from engine.market import botdata, clues, questions
from engine.market.__main__ import boalf_gb
from pipeline import replay_days

log = logging.getLogger("engine.market.pool")

KNOWN_REGIMES = {replay.HEADLINE_EVENT: "windy"}


def available() -> list[date]:
    d = replay.path(replay.HEADLINE_EVENT).parent
    return sorted(date.fromisoformat(p.name[:10]) for p in d.glob("????-??-??.json"))


def regime_of(day: date, r: dict) -> str:
    reg = r.get("regime") or KNOWN_REGIMES.get(day)
    if reg not in replay_days.REGIMES:
        raise ValueError(f"{day}: no regime recorded (calm or windy); run pipeline.replay_days generate or add it to the file")
    return reg


def explanations_for(r: dict, qs: list) -> dict[str, str]:
    """The replay's own sentence for the hour a price question asks about, when it has one."""
    by = {(s["zone"], s["target"]): s for s in r["series"]}
    out = {}
    for q in qs:
        parts = q.id.rsplit("-", 1)[0].split("-", 1)
        s = by.get((parts[0], parts[1])) if len(parts) == 2 else None
        for p in (s or {}).get("points", []):
            if p.get("explanation") and pd.Timestamp(p["ts"]).hour == q.target_hour:
                out[q.id] = p["explanation"]
    return out


def day_row(day: date, start: int = 12, end: int = 18, boalf=None, allow_no_bots: bool = False, feats=None) -> dict:
    """The pool_put arguments for one day, as a dict in the reducer's argument order."""
    r = replay.load(day)
    if r is None:
        raise ValueError(f"{day}: no replay file")
    regime = regime_of(day, r)
    problems = [p for p in replay_days.check_day(day) if "regime" not in p]
    league = botdata.load(day)
    if problems and not (allow_no_bots and league is None and all("missing replay or bots" in p for p in problems)):
        raise ValueError("; ".join(problems[:3]))
    qs = [q for q in questions.build(r, boalf, end, start, league=league, choices=True) if q.target_hour > start]
    if not qs:
        raise ValueError(f"{day}: no questions could be built")
    shop = {}
    try:
        shop = clues.build(day, qs, clues.features_for(day) if feats is None else feats, explanations_for(r, qs))
    except clues.ClueLeak:
        raise
    except Exception as e:  # the game works without clues; say so rather than failing the whole day
        log.warning("%s: no clues (%s: %s)", day, type(e).__name__, e)
    return {
        "day": day.isoformat(), "regime": regime, "start_hour": start, "end_hour": end,
        "questions_json": json.dumps([questions.league_public(q) for q in qs]),
        "answers_json": json.dumps([{"question_id": q.id, "outcome": q.outcome, "actual": q.actual} for q in qs]),
        "feed_json": json.dumps({str(h - 1): questions.feed(r, boalf, h - 1) for h in range(start + 1, end + 2)}),
        "clues_json": json.dumps(shop),
    }


def load(client, days: list[date], start: int = 12, end: int = 18, allow_no_bots: bool = False) -> list[str]:
    """Send every sound day; a day that fails its checks is skipped and reported. Returns the days loaded."""
    b = boalf_gb()
    done = []
    for d in days:
        try:
            row = day_row(d, start, end, b, allow_no_bots)
        except ValueError as e:
            log.warning("skipping %s: %s", d, e)
            continue
        if client is not None:
            client.call("pool_put", *row.values())
        done.append(d.isoformat())
        log.info("pool: %s %s, %d questions", d, row["regime"], len(json.loads(row["questions_json"])))
    return done


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--days", nargs="*", type=date.fromisoformat, help="default: every data/replay/<day>.json")
    ap.add_argument("--start", type=int, default=12)
    ap.add_argument("--end", type=int, default=18)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--allow-no-bots", action="store_true", help="load a day that has no bot quantiles yet (its bots stay out)")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    from engine.publisher.client import from_env

    client = None if args.dry_run else from_env()
    if client is None and not args.dry_run:
        log.error("no module configured: set LG_STDB_URL and a token, or pass --dry-run")
        return 1
    done = load(client, args.days or available(), args.start, args.end, args.allow_no_bots)
    print(f"{'would load' if client is None else 'loaded'} {len(done)} days: {', '.join(done)}")
    return 0 if done else 1


if __name__ == "__main__":
    sys.exit(main())
