"""Solo markets for one mystery day, built from a replay file: yes/no markets whose YES price is the model's probability.

    uv run python -m engine.pm.build [--day 2026-10-26 | --all] [--dry-run]

A market is a yes/no question on the day (engine.market.questions: will GB's day-ahead price be above X at 18:00, will
Britain pay more than Y GWh of wind to switch off). Its price path has one YES price in cents for every game hour from
the start until the market closes: the first is the model's as-of probability, then the Nowcaster's update on the hours
already played (engine.market.bots.nowcast_probability, which only reads hours before the clock). Prices at hour h use
actuals of hours before h only; the outcome comes from the actuals at close. The wind market, where we have no hourly
forecast, moves by projecting the GWh so far over the rest of the window and says so. Bots' beliefs come from the bot
league data when it exists; without it only Our model trades. Sends pm_day_put (admin identity).
"""

import argparse
import json
import logging
import re
from datetime import date

import numpy as np
import pandas as pd

from engine.market import bots as market_bots
from engine.market import questions as q
from engine.replay_days import list_days

log = logging.getLogger("engine.pm.build")

OUR_MODEL = market_bots.OUR_MODEL
BOTS = ("bot_yesterday", "bot_engineer", "lgbm_q", "bot_committee")
ID = re.compile(r"^(?P<zone>.+)-(?P<target>price_da|gb_system_price)-(?P<hour>\d+)$")


def cents(p: float) -> int:
    return int(np.clip(round(100 * p), 1, 99))


def _profile(replay: dict, zone: str, target: str) -> tuple[dict[int, dict], dict[int, float], str]:
    s = next((s for s in replay["series"] if s["zone"] == zone and s["target"] == target), None)
    if s is None:
        return {}, {}, ""
    profile, actual = {}, {}
    for p in s["points"]:
        h = pd.Timestamp(p["ts"]).hour
        if all(p.get(k) is not None for k in ("p10", "p50", "p90")):
            profile[h] = {"p10": p["p10"], "p50": p["p50"], "p90": p["p90"]}
        if p.get("actual") is not None:
            actual[h] = float(p["actual"])
    return profile, actual, q.SYMBOL.get(s["unit"], "")


def price_path(x: q.MarketQuestion, replay: dict, start: int) -> tuple[dict[str, int], dict[str, str]]:
    m = ID.match(x.id)
    zone, target = m["zone"], m["target"]
    profile, actual, sym = _profile(replay, zone, target)
    name = f"{q.ZONE_NAMES.get(zone, zone)}'s {q.TARGET_NAMES.get(target, target)}"
    prices, reasons = {}, {}
    for h in range(start, x.target_hour):
        observed = {k: v for k, v in actual.items() if start <= k < h}
        p = market_bots.nowcast_probability(x.threshold, x.target_hour, h, profile, observed, x.model_p)
        prices[str(h)] = cents(p)
        if h == start:
            reasons[str(h)] = f"Opening price: {x.model_note}"
        elif (h - 1) in profile and (h - 1) in observed:
            miss = observed[h - 1] - profile[h - 1]["p50"]
            word = "above" if miss > 0 else "below"
            reasons[str(h)] = (f"{name[0].upper()}{name[1:]} at {h - 1:02d}:00 came in {sym}{abs(miss):.0f} {word} our forecast "
                               f"({sym}{observed[h - 1]:.0f} against {sym}{profile[h - 1]['p50']:.0f}), so the odds moved.")
    return prices, reasons


def wind_path(x: q.MarketQuestion, boalf: pd.DataFrame, day: pd.Timestamp, start: int) -> tuple[dict[str, int], dict[str, str]]:
    s = boalf.set_index(pd.to_datetime(boalf["ts"], utc=True))["value"].sort_index()
    window = x.target_hour + 1
    prices, reasons = {}, {}
    for h in range(start, x.target_hour):
        so_far = s[day : day + pd.Timedelta(hours=h) - pd.Timedelta(seconds=1)].sum() / 1000
        w = h / window
        proj = so_far / h * window if h else 0.0
        p_proj = 1 / (1 + np.exp(-(proj - x.threshold) / max(1.0, 0.25 * x.threshold)))
        p = (1 - w) * x.model_p + w * p_proj
        prices[str(h)] = cents(p)
        reasons[str(h)] = (f"Opening price from history: {x.model_note}" if h == start else
                           f"{so_far:.1f} GWh switched off so far; at this pace the day ends near {proj:.0f} GWh against the {x.threshold:.0f} GWh line.")
    return prices, reasons


def markets(replay: dict, boalf: pd.DataFrame | None = None, league: dict | None = None, start: int = 12, end: int = 18) -> list[dict]:
    day = pd.Timestamp(replay["event"], tz="UTC")
    out = []
    for x in q.build(replay, boalf, end_hour=end, start_hour=start, league=league):
        if not (start < x.target_hour <= end):
            continue
        if ID.match(x.id):
            prices, reasons = price_path(x, replay, start)
        elif x.kind == "ghost_wind" and boalf is not None:
            prices, reasons = wind_path(x, boalf, day, start)
        else:
            continue
        beliefs = {n: float(np.clip(p, 0.03, 0.97)) for n, p in x.bot_p.items() if n in BOTS} or {OUR_MODEL: float(np.clip(x.model_p, 0.03, 0.97))}
        out.append({
            "id": x.id, "text": x.text, "kind": x.kind, "unit": x.unit, "close_hour": x.target_hour, "model_note": x.model_note,
            "outcome": "yes" if x.outcome else "no",
            "actual_text": f"{'Yes' if x.outcome else 'No'}: it was {x.actual:.1f} {x.unit}, against the line at {x.threshold:g}.",
            "prices": prices, "reasons": reasons, "bots": beliefs,
        })
    return out


def validate(ms: list[dict], start: int, end: int) -> None:
    """The checks pm_day_put makes in the module."""
    if not ms:
        raise ValueError("no markets could be built")
    seen = set()
    for m in ms:
        assert m["id"] and m["id"] not in seen and "|" not in m["id"], m["id"]
        seen.add(m["id"])
        assert m["outcome"] in ("yes", "no") and m["text"] and m["actual_text"], m["id"]
        assert start < m["close_hour"] <= end, m["id"]
        for h in range(start, m["close_hour"]):
            assert isinstance(m["prices"][str(h)], int) and 1 <= m["prices"][str(h)] <= 99, (m["id"], h)
        assert all(b in BOTS and 0 < p < 1 for b, p in m["bots"].items()), m["id"]


def payload(day: date, replay: dict, start: int = 12, end: int = 18, **kw) -> list:
    from engine.game import battery_pool

    ms = markets(replay, start=start, end=end, **kw)
    validate(ms, start, end)
    return [day.isoformat(), battery_pool.regime(replay), start, end, json.dumps(ms)]


def main() -> None:
    from engine import replay as rp
    from engine.market import botdata
    from engine.publisher.client import from_env
    from pipeline import cache

    ap = argparse.ArgumentParser()
    ap.add_argument("--day", type=date.fromisoformat)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    folder = rp.path(rp.HEADLINE_EVENT).parent
    days = list_days(folder) if args.all else [args.day or rp.HEADLINE_EVENT]
    client = None if args.dry_run else from_env()
    try:
        boalf = cache.read("actuals/elexon_boalf_mwh")
        boalf = boalf[boalf["zone"] == "GB"][["ts", "value"]]
    except FileNotFoundError:
        boalf = None
    for d in days:
        r = rp.load(d)
        if r is None:
            log.warning("no replay for %s", d)
            continue
        try:
            args_ = payload(d, r, boalf=boalf, league=botdata.load(d))
        except (ValueError, AssertionError) as e:
            log.warning("skipping %s: %s", d, e)
            continue
        if client:
            client.call("pm_day_put", *args_)
        log.info("pm day %s %s %d markets%s", d, args_[1], len(json.loads(args_[4])), " (dry run)" if client is None else "")


if __name__ == "__main__":
    main()
