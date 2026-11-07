"""Questions for a mystery day, built from a replay file (as-of forecasts and actuals for one real day).

Price questions ask whether a zone's price is above a round number near our median at a given hour; the model's
probability comes from its own P10/P50/P90 for that hour, made before the day. The wind question asks how much
wind Britain paid to switch off up to the end of play; the model's view there is history only (the share of the
previous 30 days that went above the line), and the question says so.
"""

import json
from dataclasses import asdict, dataclass, field

import numpy as np
import pandas as pd

from engine.market import bots

TITLE = "A real day from the past few weeks. The date stays hidden until the end."
ZONE_NAMES = {"GB": "Britain", "FR": "France", "DE-LU": "Germany", "NL": "the Netherlands", "BE": "Belgium", "NO2": "southern Norway"}
TARGET_NAMES = {"price_da": "day-ahead price", "gb_system_price": "system price"}
SYMBOL = {"GBP/MWh": "£", "EUR/MWh": "€"}
# (zone, target, hour) asked by default; hours spread over the afternoon so questions settle one by one.
PRICE_QUESTIONS = (("GB", "price_da", 18), ("GB", "gb_system_price", 15), ("DE-LU", "price_da", 17), ("FR", "price_da", 13))
P_FLOOR, P_CEIL = 0.03, 0.97


@dataclass
class MarketQuestion:
    id: str
    text: str
    kind: str
    target_hour: int
    unit: str
    threshold: float
    model_p: float
    model_note: str
    outcome: bool | str  # a bool for yes/no, else the winning option id
    actual: float
    # League fields (empty without bot quantiles for the day): each bot's P(yes) and one line on how it got there;
    # series is the feed label the Nowcaster watches and profile Our model's as-of quantiles by hour.
    bot_p: dict[str, float] = field(default_factory=dict)
    bot_notes: dict[str, str] = field(default_factory=dict)
    series: str = ""
    profile: list[dict] = field(default_factory=list)
    # A choice question (engine.market.question_types): several options, one wins. Each is {id, label, p}, p being
    # our model's probability from forecasts made before the day.
    choices: list[dict] = field(default_factory=list)

LEGACY_FIELDS = ("id", "text", "kind", "target_hour", "unit", "threshold", "model_p", "model_note")


def prob_above(x: float, p10: float, p50: float, p90: float) -> float:
    """P(value > x) from three quantiles: piecewise-linear CDF through them, tails extended at the same slopes."""
    if not p10 < p50 < p90:
        return 0.5 if x == p50 else (P_FLOOR if x > p50 else P_CEIL)
    cdf = 0.5 - 0.4 * (p50 - x) / (p50 - p10) if x <= p50 else 0.5 + 0.4 * (x - p50) / (p90 - p50)
    return float(np.clip(1 - cdf, P_FLOOR, P_CEIL))


def nice(x: float, step: float = 10.0) -> float:
    return float(max(step, round(x / step) * step))


def _point(series: dict, hour: int) -> dict | None:
    for p in series["points"]:
        if pd.Timestamp(p["ts"]).hour == hour:
            return p
    return None


def fit_hour(hour: int, start: int, end: int) -> int:
    """A question's hour inside the round, (start, end]: kept when it already fits, otherwise wrapped in.
    Before start the module refuses the opening trade; after end the clock never reaches it to settle."""
    if start < hour <= end:
        return hour
    return start + 1 + (hour - start - 1) % (end - start)


def bot_probabilities(league: dict | None, zone: str, target: str, ts: str, x: float, sym: str) -> tuple[dict, dict]:
    """(bot_p, notes) at threshold x from each bot's as-of quantiles for this zone, target and hour (see engine.market.botdata)."""
    if not league:
        return {}, {}
    for s in league.get("series", []):
        if s["zone"] == zone and s["target"] == target:
            for pt in s["points"]:
                if pd.Timestamp(pt["ts"]) == pd.Timestamp(ts):
                    p, notes = {}, {}
                    for name, q in pt["bots"].items():
                        p[name] = round(bots.band_probability(x, q["p10"], q["p50"], q["p90"]), 3)
                        notes[name] = f"median {sym}{q['p50']:.0f}, 80% range {sym}{q['p10']:.0f} to {sym}{q['p90']:.0f}"
                    return p, notes
    return {}, {}


def price_questions(replay: dict, asks=PRICE_QUESTIONS, start: int = 12, end: int = 18, league: dict | None = None) -> list[MarketQuestion]:
    by = {(s["zone"], s["target"]): s for s in replay["series"]}
    out = []
    for zone, target, asked in asks:
        hour = fit_hour(asked, start, end)
        s = by.get((zone, target))
        p = _point(s, hour) if s else None
        if not p or p.get("actual") is None or p.get("p50") is None:
            continue
        x = nice(p["p50"])
        sym = SYMBOL.get(s["unit"], "")
        made = pd.Timestamp(p["made_at"])
        bot_p, bot_notes = bot_probabilities(league, zone, target, p["ts"], x, sym)
        if bot_p:
            bot_p[bots.OUR_MODEL] = round(prob_above(x, p["p10"], p["p50"], p["p90"]), 3)  # Our model is the replay's own band
            bot_notes[bots.OUR_MODEL] = f"median {sym}{p['p50']:.0f}, 80% range {sym}{p['p10']:.0f} to {sym}{p['p90']:.0f}"
        out.append(MarketQuestion(
            id=f"{zone}-{target}-{hour:02d}", kind="price", target_hour=hour, unit=s["unit"], threshold=x,
            text=f"Will {ZONE_NAMES.get(zone, zone)}'s {TARGET_NAMES.get(target, target)} be above {sym}{x:.0f}/MWh at {hour:02d}:00?",
            model_p=round(prob_above(x, p["p10"], p["p50"], p["p90"]), 3),
            model_note=f"Our forecast made {(pd.Timestamp(p['ts']) - made).total_seconds() / 3600:.0f} h ahead: "
                       f"median {sym}{p['p50']:.0f}, 80% range {sym}{p['p10']:.0f} to {sym}{p['p90']:.0f}",
            outcome=bool(p["actual"] > x), actual=float(p["actual"]),
            bot_p=bot_p, bot_notes=bot_notes, series=f"{zone} {TARGET_NAMES.get(target, target)}" if bot_p else "",
            profile=[{"hour": pd.Timestamp(q["ts"]).hour, "p10": q["p10"], "p50": q["p50"], "p90": q["p90"]} for q in s["points"]] if bot_p else [],
        ))
    return out


def wind_question(day: pd.Timestamp, boalf: pd.DataFrame, end_hour: int, history_days: int = 30) -> MarketQuestion | None:
    """boalf: ts, value (MWh of accepted bids for wind units per hour, GB)."""
    if boalf is None or boalf.empty:
        return None
    s = boalf.set_index(pd.to_datetime(boalf["ts"], utc=True))["value"].sort_index()
    upto = lambda d: s[d : d + pd.Timedelta(hours=end_hour) - pd.Timedelta(seconds=1)].sum() / 1000  # noqa: E731
    days = [day - pd.Timedelta(days=i) for i in range(1, history_days + 1)]
    past = np.array([upto(d) for d in days if len(s[d : d + pd.Timedelta(hours=end_hour - 1)])])
    today = s[day : day + pd.Timedelta(hours=end_hour - 1)]
    if len(past) < 10 or len(today) < end_hour:
        return None
    y = nice(float(np.median(past)), 5.0)
    actual = float(today.sum() / 1000)
    return MarketQuestion(
        id=f"GB-wind-off-{end_hour:02d}", kind="ghost_wind", target_hour=end_hour - 1, unit="GWh", threshold=y,
        text=f"Will Britain pay wind farms to switch off more than {y:.0f} GWh between midnight and {end_hour:02d}:00?",
        model_p=round(float(np.clip((past > y).mean(), P_FLOOR, P_CEIL)), 3),
        model_note=f"History only, not a forecast: {int((past > y).sum())} of the previous {len(past)} days went above {y:.0f} GWh",
        outcome=bool(actual > y), actual=actual,
    )


def build(replay: dict, boalf: pd.DataFrame | None = None, end_hour: int = 18, start_hour: int = 12,
          league: dict | None = None, choices: bool = False, net_import: pd.DataFrame | None = None) -> list[MarketQuestion]:
    """The day's yes/no questions; with choices=True also the choice questions of engine.market.question_types."""
    day = pd.Timestamp(replay["event"], tz="UTC")
    qs = price_questions(replay, start=start_hour, end=end_hour, league=league)
    w = wind_question(day, boalf, end_hour) if boalf is not None else None
    extra = []
    if choices:
        from engine.market import question_types

        extra = question_types.choice_questions(replay, boalf, net_import, start_hour, end_hour)
    return sorted(qs + ([w] if w else []) + extra, key=lambda x: (x.target_hour, x.id))


def public(q: MarketQuestion) -> dict:
    """What the module may show players before settlement (no outcome, no actual): the fields market_start accepts today."""
    d = asdict(q)
    return {k: d[k] for k in LEGACY_FIELDS}


def league_public(q: MarketQuestion) -> dict:
    """What market_start_league takes: public() plus each bot's probability and note, the feed label and Our model's profile.

    bot_p becomes a list of {bot, p, note} and profile a JSON string, the shapes the module's reducer declares.
    """
    d = public(q)
    d["bot_p"] = [{"bot": n, "p": p, "note": q.bot_notes.get(n, "")} for n, p in q.bot_p.items()]
    d["series"] = q.series
    d["profile_json"] = json.dumps(q.profile) if q.profile else ""
    if q.choices:
        d["choices"] = q.choices
    return d


def feed(replay: dict, boalf: pd.DataFrame | None, hour: int) -> list[dict]:
    """What happened in `hour`, shown as the clock passes it: GB prices and wind switched off so far."""
    out = []
    for s in replay["series"]:
        if s["zone"] == "GB" or (s["zone"], s["target"]) in {(z, t) for z, t, _ in PRICE_QUESTIONS}:
            p = _point(s, hour)
            if p and p.get("actual") is not None:
                out.append({"label": f"{s['zone']} {TARGET_NAMES.get(s['target'], s['target'])}", "value": round(float(p["actual"]), 2), "unit": s["unit"]})
    if boalf is not None and len(boalf):
        day = pd.Timestamp(replay["event"], tz="UTC")
        s = boalf.set_index(pd.to_datetime(boalf["ts"], utc=True))["value"].sort_index()
        so_far = s[day : day + pd.Timedelta(hours=hour)].sum() / 1000
        out.append({"label": "GB wind switched off so far", "value": round(float(so_far), 1), "unit": "GWh"})
    return out
