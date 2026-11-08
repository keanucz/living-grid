"""Market library: 8 to 12 concrete yes/no markets for a mystery day, each with our probability at open and at every game hour.

    uv run python -m engine.market.library build --day 2026-10-26 [--start 12] [--end 18]
    uv run python -m engine.market.library check --day 2026-10-26

Price markets use the day's as-of quantile forecasts (data/replay/<day>.json, made before the day). When the clock
passes an hour the band is shifted by the latest miss, fading by half every hour, so the probability moves with what
players can see. Every other market has no model of its own, so its probability is a history-only estimate: past
days weighted by how close their reading at this hour was to today's, shrunk to the base rate. Each market says
which method it used. Weather markets take their probabilities from ensemble forecasts issued before the day through
a WeatherSource; with none, they are left out rather than invented.

The probability at game hour h uses only readings up to hour h-1, the hours the feed has shown by then. Outcomes and
actuals are written to a separate `answers` list that the game keeps private until a market closes.
"""

import argparse
import json
import logging
import sys
from dataclasses import dataclass, field
from datetime import date
from typing import Protocol

import numpy as np
import pandas as pd

from engine.market.questions import P_CEIL, P_FLOOR, prob_above

log = logging.getLogger("engine.market.library")

HISTORY_DAYS = 60
MIN_HISTORY = 20
MAX_MARKETS = 12
MIN_MARKETS = 8
PRIOR_WEIGHT = 1.0
RESIDUAL_FADE = 0.5  # share of a forecast miss still carried one hour later
OPEN_RANGE = (0.2, 0.8)  # a market whose opening probability falls outside this is not uncertain enough to play


class WeatherSource(Protocol):
    def markets(self, day: pd.Timestamp, start: int, end: int) -> list["Market"]: ...


@dataclass
class Market:
    id: str
    text: str
    kind: str
    zone: str
    unit: str
    threshold: float
    direction: str  # "above" or "below"
    target_hour: int
    method: str
    source: str
    model_note: str
    history: list[dict] = field(default_factory=list)  # {hour, p, basis}; hour is the game clock hour the p applies from
    outcome: bool | None = None
    actual: float | None = None

    @property
    def open_p(self) -> float:
        return self.history[0]["p"]


class Hourly(Protocol):
    def get(self, zone: str, series: str) -> pd.Series: ...


def clip(p: float) -> float:
    return round(float(np.clip(p, P_FLOOR, P_CEIL)), 3)


def nice(x: float, step: float) -> float:
    return float(round(x / step) * step)


def day_values(s: pd.Series, day: pd.Timestamp) -> pd.Series:
    return s[day: day + pd.Timedelta(hours=23)]


def past_days(day: pd.Timestamp, n: int = HISTORY_DAYS) -> list[pd.Timestamp]:
    return [day - pd.Timedelta(days=i) for i in range(1, n + 1)]


# ---------- history-only probability ----------

@dataclass
class Reading:
    """How a history-only market reads a day: the settled value, and the partial value known by hour h (readings to h-1)."""
    settle: callable
    so_far: callable


def point(s: pd.Series, hour: int) -> Reading:
    return Reading(lambda d: s.get(d + pd.Timedelta(hours=hour)), lambda d, h: s.get(d + pd.Timedelta(hours=h - 1)))


def cumulative(s: pd.Series, hour: int) -> Reading:
    """Sum of hours 0 to `hour` inclusive; partial sum to h-1."""
    def total(d, h):
        w = s[d: d + pd.Timedelta(hours=h)]
        return float(w.sum()) if len(w) == h + 1 else None

    return Reading(lambda d: total(d, hour), lambda d, h: (lambda w: float(w.sum()) if len(w) == h else None)(s[d: d + pd.Timedelta(hours=h - 1)]))


def analog_rows(read: Reading, day: pd.Timestamp, h: int) -> tuple[np.ndarray, np.ndarray, float | None]:
    """(settled values, readings at hour h, today's reading) over the past days that have both."""
    rows = []
    for d in past_days(day):
        y, f = read.settle(d), read.so_far(d, h)
        if y is not None and f is not None and not (np.isnan(y) or np.isnan(f)):
            rows.append((y, f))
    if len(rows) < MIN_HISTORY:
        raise ValueError("not enough history")
    ys, fs = np.array(rows).T
    today = read.so_far(day, h)
    return ys, fs, (None if today is None or np.isnan(today) else float(today))


def analog_weights(fs: np.ndarray, today: float | None) -> np.ndarray:
    if today is None or fs.std() == 0:
        return np.ones(len(fs))
    return np.exp(-0.5 * ((fs - today) / (0.5 * fs.std())) ** 2)


def analog_probability(read: Reading, day: pd.Timestamp, h: int, x: float, above: bool) -> tuple[float, int]:
    """P(settled value beyond x) from past days weighted by closeness at hour h, shrunk toward the base rate. Returns (p, days used)."""
    ys, fs, today = analog_rows(read, day, h)
    hit = (ys > x) if above else (ys < x)
    base = float(hit.mean())
    if today is None or fs.std() == 0:
        return base, len(ys)
    w = analog_weights(fs, today)
    return float((w @ hit + PRIOR_WEIGHT * base) / (w.sum() + PRIOR_WEIGHT)), len(ys)


def weighted_median(v: np.ndarray, w: np.ndarray) -> float:
    o = np.argsort(v)
    c = np.cumsum(w[o])
    return float(v[o][np.searchsorted(c, c[-1] / 2)])


def history_market(mid: str, text: str, kind: str, zone: str, unit: str, read: Reading, day: pd.Timestamp, start: int, target_hour: int,
                   step: float, source: str, above: bool = True, scale: float = 1.0, note: str = "") -> Market | None:
    try:
        ys, fs, today = analog_rows(read, day, start)
    except ValueError:
        return None
    vals = ys * scale
    sd = float(vals.std())
    step = next((st for st in (step, step / 2, step / 5, step / 10, step / 20) if st <= 0.25 * sd), step / 20)  # a round number that cannot move p much
    x = nice(weighted_median(vals, analog_weights(fs, today)), step)  # the median given what is known at the opening hour
    if kind != "weather" and x == 0 and above:
        x = step
    m = Market(mid, text.format(x=f"{x:g}"), kind, zone, unit, x, "above" if above else "below", target_hour,
               "history only", source, note or f"History only, not a forecast: {int((vals > x).sum())} of the previous {len(vals)} days went above {x:g} {unit}")
    scaled = Reading(lambda d: None if read.settle(d) is None else read.settle(d) * scale, lambda d, h: None if read.so_far(d, h) is None else read.so_far(d, h) * scale)
    for h in range(start, target_hour + 1):
        try:
            p, n = analog_probability(scaled, day, h, x, above)
        except ValueError:
            return None
        m.history.append({"hour": h, "p": clip(p), "basis": f"{n} past days, weighted by how close they were at {h - 1:02d}:00" if h > start else f"base rate over {n} past days"})
    return m


# ---------- price markets from the as-of quantile forecast ----------

def band(points: dict[int, dict], actual: dict[int, float], h: int, t: int) -> tuple[float, float, float]:
    """P10/P50/P90 for hour t as seen at game hour h: shifted by the latest miss (hour h-1), fading by half per hour."""
    p = points[t]
    last = h - 1
    if last in actual and last in points and t > last:
        shift = (actual[last] - points[last]["p50"]) * RESIDUAL_FADE ** (t - last)
        return p["p10"] + shift, p["p50"] + shift, p["p90"] + shift
    return p["p10"], p["p50"], p["p90"]


def price_series(replay: dict, zone: str, target: str) -> tuple[dict[int, dict], dict[int, float], str] | None:
    for s in replay["series"]:
        if s["zone"] == zone and s["target"] == target:
            pts = {pd.Timestamp(p["ts"]).hour: p for p in s["points"]}
            act = {h: float(p["actual"]) for h, p in pts.items() if p.get("actual") is not None}
            return pts, act, s["unit"]
    return None


def price_market(replay: dict, mid: str, text: str, zone: str, target: str, kind: str, start: int, target_hour: int, mode: str,
                 step: float, rel: float | None = None) -> Market | None:
    got = price_series(replay, zone, target)
    if not got:
        return None
    pts, act, unit = got
    if target_hour not in pts or (mode == "point" and target_hour not in act):
        return None
    sym = {"GBP/MWh": "£", "EUR/MWh": "€"}.get(unit, "")
    if mode == "rel":  # up by more than rel against the price players see at the start of play
        base = act.get(start - 1)
        if base is None:
            return None
        x, above = base * (1 + rel), True
    elif mode == "daymax":
        x, above = nice(max(p["p50"] for h, p in pts.items() if start <= h <= target_hour), step), True
    elif mode == "anyneg":
        x, above = 0.0, False
    else:
        x, above = nice(pts[target_hour]["p50"], step), True
    hours = sorted(h for h in pts if start <= h <= target_hour) if mode in ("daymax", "anyneg") else sorted(pts)

    def prob(h: int) -> float:
        if mode in ("point", "rel"):
            return prob_above(x, *band(pts, act, h, target_hour))
        so_far = [act[t] for t in hours if t <= h - 1 and t in act]
        left = [t for t in hours if t >= h] or [hours[-1]]
        if mode == "daymax":
            if so_far and max(so_far) > x:
                return 1.0
            return max(prob_above(x, *band(pts, act, h, t)) for t in left)
        if so_far and min(so_far) < 0:
            return 1.0
        return max(1 - prob_above(x, *band(pts, act, h, t)) for t in left)

    m = Market(mid, text.format(x=f"{sym}{x:.0f}"), kind, zone, unit, round(float(x), 2), "above" if above else "below", target_hour,
               "as-of quantile forecast" + (", highest hour (hours move together)" if mode in ("daymax", "anyneg") else ""),
               f"Our as-of {target} forecast for {zone}, made before the day (data/replay)",
               "Forecasts made before the day; after each hour the band shifts by the latest miss, fading by half an hour later.")
    for h in range(start, target_hour + 1):
        m.history.append({"hour": h, "p": clip(prob(h)), "basis": f"forecast shifted by what happened to {h - 1:02d}:00"})
    window = [act[h] for h in hours if h in act]
    if mode == "anyneg" and window:
        m.outcome, m.actual = bool(min(window) < 0), float(min(window))
    elif mode == "daymax" and window:
        m.outcome, m.actual = bool(max(window) > x), float(max(window))
    elif mode in ("point", "rel"):
        m.outcome, m.actual = bool(act[target_hour] > x), float(act[target_hour])
    else:
        return None
    return m


# ---------- the library ----------

def build(day: date, replay: dict, data: Hourly, boalf: pd.Series | None, start: int = 12, end: int = 18,
          weather: WeatherSource | None = None) -> list[Market]:
    d0 = pd.Timestamp(day, tz="UTC")
    out: list[Market] = []
    add = lambda m: out.append(m) if m else None
    t = lambda h: min(max(h, start + 1), end)

    add(price_market(replay, "GB-da-up10-18", f"Will Britain's day-ahead price at 18:00 be more than 10% above the {start - 1:02d}:00 price?", "GB", "price_da", "price", start, t(18), "rel", 1.0, rel=0.10))
    add(price_market(replay, "GB-da-max", f"Will Britain's day-ahead price go above {{x}}/MWh at any hour between {start}:00 and {end}:00?", "GB", "price_da", "price", start, end, "daymax", 10.0))
    add(price_market(replay, "DE-da-neg", f"Will Germany see a negative day-ahead price in any hour between {start}:00 and {end}:00?", "DE-LU", "price_da", "price", start, end, "anyneg", 1.0))
    add(price_market(replay, "FR-da-13", "Will France's day-ahead price at 13:00 be above {x}/MWh?", "FR", "price_da", "price", start, t(13), "point", 10.0))

    wind = data.get("GB", "gen_wind")
    if len(wind):
        add(history_market("GB-wind-15", "Will Britain's wind generation be above {x} GW at 15:00?", "wind", "GB", "GW", point(wind, 15), d0, start, t(15), 0.5,
                           "Elexon FUELHH, hourly mean", scale=1e-3))
    solar = data.get("DE-LU", "gen_solar")
    if len(solar):
        add(history_market("DE-solar-13", "Will German solar generation be above {x} GW at 13:00?", "solar", "DE-LU", "GW", point(solar, 13), d0, start, t(13), 1.0,
                           "Energy-Charts generation, DE-LU", scale=1e-3))
    imports = sum((data.get("GB", f"flow_GB_{z}").reindex(wind.index) for z in ("BE", "DK1", "FR", "IE", "NI", "NL", "NO2")), start=pd.Series(0.0, index=wind.index)) * -1 if len(wind) else None
    if imports is not None:
        add(history_market("GB-imports-17", "Will Britain be importing more than {x} GW at 17:00?", "imports", "GB", "GW", point(imports, 17), d0, start, t(17), 0.5,
                           "Elexon interconnector flows, imports positive", scale=1e-3))
    if boalf is not None and len(boalf):
        add(history_market("GB-ghost-18", "Will Britain pay generators to turn down more than {x} GWh by 18:00?", "ghost_wind", "GB", "GWh", cumulative(boalf, end - 1), d0, start, end, 1.0,
                           "Elexon BOALF accepted bids, summed", scale=1e-3))
    if weather is not None:
        out.extend(weather.markets(d0, start, end))
    mk = [m for m in out if OPEN_RANGE[0] <= m.open_p <= OPEN_RANGE[1]]
    for m in out:
        if m not in mk:
            log.warning("%s: opening probability %.2f is outside %s; left out", m.id, m.open_p, OPEN_RANGE)
    if len(mk) < MIN_MARKETS:
        log.warning("%s: only %d markets for the day (want at least %d)", day, len(mk), MIN_MARKETS)
    return mk[:MAX_MARKETS]


def settle_history_markets(markets: list[Market], data: Hourly, boalf: pd.Series | None, day: pd.Timestamp) -> None:
    """Fill outcome and actual for history-only markets from the day's own readings (after the fact; never shown before close)."""
    wind, solar = data.get("GB", "gen_wind"), data.get("DE-LU", "gen_solar")
    for m in markets:
        if m.outcome is not None:
            continue
        v = None
        if m.id == "GB-wind-15" and len(wind):
            v = wind.get(day + pd.Timedelta(hours=15), np.nan) / 1000
        elif m.id == "DE-solar-13" and len(solar):
            v = solar.get(day + pd.Timedelta(hours=13), np.nan) / 1000
        elif m.id == "GB-imports-17" and len(wind):
            v = -sum(data.get("GB", f"flow_GB_{z}").get(day + pd.Timedelta(hours=17), 0.0) for z in ("BE", "DK1", "FR", "IE", "NI", "NL", "NO2")) / 1000
        elif m.id == "GB-ghost-18" and boalf is not None:
            v = float(boalf[day: day + pd.Timedelta(hours=17)].sum()) / 1000
        if v is not None and not np.isnan(v):
            m.actual = float(v)
            m.outcome = bool(v > m.threshold) if m.direction == "above" else bool(v < m.threshold)


def public(m: Market) -> dict:
    """What the game may show before the market closes: no outcome, no actual."""
    return {"id": m.id, "text": m.text, "kind": m.kind, "zone": m.zone, "unit": m.unit, "threshold": m.threshold, "direction": m.direction,
            "close_hour": m.target_hour, "open_p": m.open_p, "history": m.history, "method": m.method, "source": m.source, "model_note": m.model_note}


def document(day: date, markets: list[Market], start: int, end: int) -> dict:
    return {"day": day.isoformat(), "start_hour": start, "end_hour": end, "markets": [public(m) for m in markets],
            "answers": [{"id": m.id, "outcome": m.outcome, "actual": m.actual} for m in markets]}


def problems(doc: dict) -> list[str]:
    """What is wrong with a day's library: count, openings, history, source, and any outcome leaking into the public part."""
    errs = []
    n = len(doc["markets"])
    if not MIN_MARKETS <= n <= MAX_MARKETS:
        errs.append(f"{doc['day']}: {n} markets, expected {MIN_MARKETS} to {MAX_MARKETS}")
    for m in doc["markets"]:
        if not m.get("source") or not m.get("method"):
            errs.append(f"{m['id']}: no source or method")
        if not m["history"] or m["history"][0]["hour"] != doc["start_hour"]:
            errs.append(f"{m['id']}: history does not start at the opening hour")
        if not OPEN_RANGE[0] <= m["open_p"] <= OPEN_RANGE[1]:
            errs.append(f"{m['id']}: opening probability {m['open_p']} is not uncertain")
        if any(k in m for k in ("outcome", "actual")):
            errs.append(f"{m['id']}: outcome leaks into the public part")
    ids = {a["id"] for a in doc["answers"]}
    if ids != {m["id"] for m in doc["markets"]}:
        errs.append(f"{doc['day']}: answers do not match markets")
    return errs


class CacheData:
    """Hourly series from the cached actuals (engine.data), keyed by zone and series."""

    def __init__(self):
        from engine import data
        self.a = data.actuals()
        self._c: dict = {}

    def get(self, zone: str, series: str) -> pd.Series:
        k = (zone, series)
        if k not in self._c:
            a = self.a[(self.a["zone"] == zone) & (self.a["series"] == series)]
            self._c[k] = (a.assign(ts=pd.to_datetime(a["ts"], utc=True).dt.floor("h")).groupby("ts")["value"].mean().sort_index()
                          if len(a) else pd.Series(dtype=float))
        return self._c[k]


def main(argv=None) -> int:
    from pipeline import cache

    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("cmd", choices=["build", "check"])
    ap.add_argument("--day", required=True)
    ap.add_argument("--start", type=int, default=12)
    ap.add_argument("--end", type=int, default=18)
    ap.add_argument("--data", help="read the cache from this directory instead of data/")
    a = ap.parse_args(argv)
    if a.data:
        from pathlib import Path
        cache.DATA = Path(a.data)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    day = date.fromisoformat(a.day)
    out = cache.DATA / "replay" / f"{day.isoformat()}.markets.json"
    if a.cmd == "check":
        errs = problems(json.loads(out.read_text()))
        print("\n".join(errs) or "sound")
        return 1 if errs else 0
    from engine import replay
    from engine.market.__main__ import boalf_gb

    r = replay.load(day)
    if r is None:
        log.error("no replay for %s", day)
        return 1
    b = boalf_gb()
    boalf = None if b is None else b.set_index(pd.to_datetime(b["ts"], utc=True))["value"].sort_index()
    data = CacheData()
    ms = build(day, r, data, boalf, a.start, a.end)
    settle_history_markets(ms, data, boalf, pd.Timestamp(day, tz="UTC"))
    ms = [m for m in ms if m.outcome is not None]
    doc = document(day, ms, a.start, a.end)
    errs = problems(doc)
    if errs:
        log.error("\n".join(errs))
    out.write_text(json.dumps(doc, indent=1))
    log.info("wrote %s with %d markets", out, len(ms))
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
