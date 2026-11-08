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
import hashlib
import json
import logging
import re
from datetime import date

import numpy as np
import pandas as pd

from engine.market import bots as market_bots
from engine.market import calibrate
from engine.market import questions as q
from engine.replay_days import list_days

log = logging.getLogger("engine.pm.build")

OUR_MODEL = market_bots.OUR_MODEL
BOTS = ("bot_yesterday", "bot_engineer", "lgbm_q", "bot_committee")
ID = re.compile(r"^(?P<zone>.+)-(?P<target>price_da|gb_system_price)-(?P<hour>\d+)$")
# A market whose opening price is this close to 0 or 100 is already decided: it is not offered (#236, #286).
OPEN_MIN, OPEN_MAX = 3, 97
WIND_HISTORY_DAYS = 30


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


def _sha(text: str) -> int:
    return int(hashlib.sha256(text.encode()).hexdigest()[:8], 16)


def directions(day: str, ids: list[str]) -> dict[str, str]:
    """About half of a day's price markets ask "below": in hash order, alternating, starting from a coin flip per day.
    A one-sided bias in our median then cannot be harvested by pressing YES on everything (#236). Stable per day."""
    order = sorted(ids, key=lambda m: _sha(f"{day}|{m}"))
    first = _sha(day) % 2
    return {m: ("above", "below")[(k + first) % 2] for k, m in enumerate(order)}


def price_market(x: q.MarketQuestion, replay: dict, start: int, direction: str = "above") -> dict:
    """One price market. "below" is the mirror of "above": the same line, the YES price 100 - p, every belief 1 - p."""
    prices, reasons = price_path(x, replay, start)
    beliefs = {n: float(np.clip(p, 0.03, 0.97)) for n, p in x.bot_p.items() if n in BOTS} or {OUR_MODEL: float(np.clip(x.model_p, 0.03, 0.97))}
    yes = bool(x.outcome)
    text = x.text
    if direction == "below":
        text = text.replace(" be above ", " be below ")
        prices = {h: 100 - c for h, c in prices.items()}
        beliefs = {n: 1 - p for n, p in beliefs.items()}
        yes = not yes
    return {
        "id": x.id, "text": text, "kind": x.kind, "direction": direction, "unit": x.unit, "close_hour": x.target_hour,
        "model_note": x.model_note, "outcome": "yes" if yes else "no",
        "actual_text": f"{'Yes' if yes else 'No'}: it was {x.actual:.1f} {x.unit}, against the line at {x.threshold:g}.",
        "prices": prices, "reasons": reasons, "bots": beliefs,
    }


def _hourly(boalf: pd.DataFrame) -> pd.Series:
    return boalf.set_index(pd.to_datetime(boalf["ts"], utc=True))["value"].sort_index()


def _gwh(s: pd.Series, day: pd.Timestamp, hour: int) -> float:
    """GWh switched off from midnight up to the start of `hour`."""
    return float(s[day : day + pd.Timedelta(hours=hour) - pd.Timedelta(seconds=1)].sum() / 1000)


def wind_market(day: pd.Timestamp, boalf: pd.DataFrame, start: int, end: int, history_days: int = WIND_HISTORY_DAYS) -> dict | None:
    """Will Britain pay wind farms to switch off more than Y GWh between midnight and `end`?

    Wind switched off only adds up, so the line is set above what is already off at the opening hour: the GWh so far
    plus the median of what followed on past days. The price at every hour is history conditioned on the clock: the
    share of past days on which at least the missing amount followed from that hour to `end`; once the line is passed
    the market is settled and the price is 99. The note states that same basis, so the opening price is what it says."""
    if boalf is None or boalf.empty:
        return None
    s = _hourly(boalf)
    past = [day - pd.Timedelta(days=i) for i in range(1, history_days + 1)]
    past = [d for d in past if len(s[d : d + pd.Timedelta(hours=end - 1)]) >= end]
    if len(past) < 10 or len(s[day : day + pd.Timedelta(hours=end - 1)]) < end:
        return None
    totals = np.array([_gwh(s, d, end) for d in past])
    later = lambda h: totals - np.array([_gwh(s, d, h) for d in past])  # noqa: E731 - what followed from hour h to end
    now = _gwh(s, day, start)
    y = q.nice(now + float(np.median(later(start))), 5.0)
    while y <= now:
        y += 5.0
    actual = _gwh(s, day, end)
    prices, reasons = {}, {}
    note = ""
    for h in range(start, end - 1):
        so_far = _gwh(s, day, h)
        need = y - so_far
        if need < 0:
            prices[str(h)] = 99
            reasons[str(h)] = f"{so_far:.1f} GWh switched off so far, past the {y:.0f} GWh line: this one is settled."
            continue
        rest = later(h)
        k = int((rest > need).sum())
        prices[str(h)] = cents(k / len(rest))
        line = (f"{so_far:.1f} GWh already switched off by {h:02d}:00, and on {k} of the previous {len(rest)} days "
                f"at least {need:.1f} GWh more followed by {end:02d}:00")
        if h == start:
            note = f"History only, not a forecast: {line}"
            reasons[str(h)] = f"Opening price: {note}"
        else:
            reasons[str(h)] = f"{line[0].upper()}{line[1:]}."
    return {
        "id": f"GB-wind-off-{end:02d}", "kind": "ghost_wind", "direction": "above", "unit": "GWh", "close_hour": end - 1,
        "text": f"Will Britain pay wind farms to switch off more than {y:.0f} GWh between midnight and {end:02d}:00?",
        "model_note": note, "outcome": "yes" if actual > y else "no",
        "actual_text": f"{'Yes' if actual > y else 'No'}: it was {actual:.1f} GWh, against the line at {y:g}.",
        "prices": prices, "reasons": reasons, "bots": {OUR_MODEL: float(np.clip(prices[str(start)] / 100, 0.03, 0.97))},
    }


def markets(replay: dict, boalf: pd.DataFrame | None = None, league: dict | None = None, start: int = 12, end: int = 18,
            calibration=None) -> list[dict]:
    day = pd.Timestamp(replay["event"], tz="UTC")
    qs = [x for x in q.build(replay, None, end_hour=end, start_hour=start, league=league, calibration=calibration) if start < x.target_hour <= end and ID.match(x.id)]
    dirs = directions(replay["event"], [x.id for x in qs])
    out = [price_market(x, replay, start, dirs[x.id]) for x in qs]
    w = wind_market(day, boalf, start, end) if boalf is not None else None
    if w and start < w["close_hour"] <= end:
        out.append(w)
    # Nothing that is already decided at the open: a 3 or a 97 there is a free trade, not a question.
    out = [m for m in out if OPEN_MIN < m["prices"][str(start)] < OPEN_MAX]
    return sorted(out, key=lambda m: (m["close_hour"], m["id"]))


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
    replays = {d: rp.load(d) for d in list_days(folder)}
    for d in days:
        r = replays.get(d) or rp.load(d)
        if r is None:
            log.warning("no replay for %s", d)
            continue
        try:
            args_ = payload(d, r, boalf=boalf, league=botdata.load(d), calibration=calibrate.for_day(d, [x for x in replays.values() if x]))
        except (ValueError, AssertionError) as e:
            log.warning("skipping %s: %s", d, e)
            continue
        if client:
            client.call("pm_day_put", *args_)
        log.info("pm day %s %s %d markets%s", d, args_[1], len(json.loads(args_[4])), " (dry run)" if client is None else "")


if __name__ == "__main__":
    main()
