"""When and where to run a compute job: the cheapest start time per zone at our day-ahead price forecasts.

The same window search as the household advice, hourly and on wholesale prices: for a job drawing `kw` for
`hours`, find the start before the deadline with the lowest median energy cost, and compare it with starting at
the next hour. Hours whose day-ahead auction has cleared use the real price (no spread); later hours use the
latest forecast made by `now`. The P10 to P90 range applies the forecast band to both windows together
(perfectly correlated), so it is a plausible range, not a probability. Wholesale energy only: no network
charges, levies or taxes, which a real data centre also pays.
"""

from datetime import datetime

import numpy as np
import pandas as pd

from engine import data
from engine.battery.compare import EUR_PER_GBP
from pipeline import cache

TARGET = "price_da"
QUANTILES = ("p10", "p50", "p90")
DEFAULT_KW = 1000.0  # 1 MW: a rack of about 70 eight-GPU servers
DEFAULT_HOURS = 6
DEFAULT_WINDOW_H = 24
MAX_WINDOW_H = 48
MAX_HOURS = 24
MAX_KW = 1_000_000.0  # 1 GW, the largest single campuses announced


class BadRequest(ValueError):
    pass


def clock() -> pd.Timestamp:
    return pd.Timestamp.now(tz="UTC")


def default_now() -> pd.Timestamp:
    """Now. Offline, capped at the latest forecast run so the fixtures still give an answer."""
    now = clock()
    if cache.offline():
        log = data.forecast_log()
        if len(log):
            now = min(now, log["made_at"].max())
    return now


def cleared(zones: list[str], start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
    """Hourly day-ahead prices already known for [start, end): zone, ts, price (preferred source per hour)."""
    a = data.actuals()
    a = a[(a["series"] == TARGET) & a["zone"].isin(zones)]
    a = a.assign(ts=pd.to_datetime(a["ts"], utc=True).dt.floor("h"))
    a = a[(a["ts"] >= start) & (a["ts"] < end)]
    if a.empty:
        return pd.DataFrame(columns=["zone", "ts", "price"])
    a = a.groupby(["zone", "ts", "source"], as_index=False)["value"].mean()
    a["rank"] = a["source"].map({s: i for i, s in enumerate(data.PRICE_SOURCES)}).fillna(len(data.PRICE_SOURCES))
    a = a.sort_values("rank").drop_duplicates(["zone", "ts"])
    return a.rename(columns={"value": "price"})[["zone", "ts", "price"]]


def price_table(zone: str, now: pd.Timestamp, start: pd.Timestamp, end: pd.Timestamp,
                log: pd.DataFrame, known: pd.DataFrame) -> pd.DataFrame:
    """Hourly p10/p50/p90 and kind for one zone over [start, end), indexed by ts; missing hours dropped."""
    f = log[(log["zone"] == zone) & (log["target"] == TARGET) & (log["made_at"] <= now)]
    f = f[(f["ts"] >= start) & (f["ts"] < end)]
    f = f.sort_values("made_at").drop_duplicates("ts", keep="last").set_index("ts")[list(QUANTILES)].sort_index()
    out = f.astype(float).assign(kind="forecast")
    q = np.sort(out[list(QUANTILES)].to_numpy(), axis=1)
    out[list(QUANTILES)] = q
    for r in known[known["zone"] == zone].itertuples():
        out.loc[r.ts, list(QUANTILES)] = [float(r.price)] * 3
        out.loc[r.ts, "kind"] = "actual"
    return out.sort_index()


def best_window(table: pd.DataFrame, start: pd.Timestamp, end: pd.Timestamp, hours: int, mwh: float) -> dict | None:
    """Cheapest contiguous window by median cost, and the window starting at `start` as the baseline."""
    slots = pd.date_range(start, end - pd.Timedelta(hours=1), freq="h")
    best = base = None
    for i in range(len(slots) - hours + 1):
        w = slots[i: i + hours]
        if not w.isin(table.index).all():
            continue
        cost = table.loc[w, list(QUANTILES)].sum() * mwh
        if i == 0:
            base = (w, cost)
        if best is None or cost["p50"] < best[1]["p50"]:
            best = (w, cost)
    if best is None or base is None:
        return None
    (w, cost), (bw, bcost) = best, base
    saving = np.sort([bcost[q] - cost[q] for q in QUANTILES])
    kind = "actual" if (table.loc[w.union(bw), "kind"] == "actual").all() else "forecast"
    if kind == "actual":
        saving = np.full(3, saving[1])
    return {"window": w, "cost": cost, "cost_now": bcost, "saving": saving, "kind": kind}


def _q(values) -> dict:
    return dict(zip(QUANTILES, (round(float(x), 2) for x in values), strict=True))


def parse_zones(zones: str | None) -> list[str]:
    if not zones:
        return list(data.ZONES)
    out = [z.strip().upper() for z in zones.split(",") if z.strip()]
    bad = [z for z in out if z not in data.ZONES]
    if bad or not out:
        raise BadRequest(f"unknown zone {', '.join(bad) or zones!r}; use any of {', '.join(data.ZONES)}")
    return list(dict.fromkeys(out))


def build(kw: float = DEFAULT_KW, hours: int = DEFAULT_HOURS, zones: str | None = None,
          deadline: datetime | None = None, now: datetime | None = None) -> dict:
    if not 0 < kw <= MAX_KW:
        raise BadRequest(f"kw must be above 0 and at most {MAX_KW:,.0f}")
    if not 1 <= hours <= MAX_HOURS:
        raise BadRequest(f"hours must be between 1 and {MAX_HOURS}")
    names = parse_zones(zones)
    t = data.as_utc(now) if now is not None else default_now()
    start = t.floor("h") + pd.Timedelta(hours=1)
    end = data.as_utc(deadline).floor("h") if deadline is not None else start + pd.Timedelta(hours=DEFAULT_WINDOW_H)
    end = min(end, start + pd.Timedelta(hours=MAX_WINDOW_H))
    if end - start < pd.Timedelta(hours=hours):
        raise BadRequest(f"the deadline leaves less than {hours} hours from {start:%H:00} UTC")
    mwh = kw / 1000
    log, known = data.forecast_log(), cleared(names, start, end)
    rows = []
    for zone in names:
        table = price_table(zone, t, start, end, log, known)
        b = best_window(table, start, end, hours, mwh)
        if b is None:
            continue
        cur = data.CURRENCY[zone]
        fx = EUR_PER_GBP if cur == "GBP" else 1.0
        w = b["window"]
        rows.append({
            "zone": zone, "currency": cur, "unit": f"{cur}/MWh",
            "start": w[0].to_pydatetime(), "end": (w[-1] + pd.Timedelta(hours=1)).to_pydatetime(),
            "avg_price": _q(table.loc[w, list(QUANTILES)].mean()),
            "cost": _q(b["cost"]), "cost_now": _q(b["cost_now"]), "saving": _q(b["saving"]),
            "cost_eur": _q(b["cost"] * fx), "saving_eur": _q(b["saving"] * fx), "kind": b["kind"],
            "prices": [{"ts": ts.to_pydatetime(), **{q: round(float(r[q]), 2) for q in QUANTILES}, "kind": r["kind"]}
                       for ts, r in table.iterrows()],
        })
    rows.sort(key=lambda r: r["cost_eur"]["p50"])
    note = (
        f"Wholesale day-ahead energy only for {kw:,.0f} kW over {hours} hours: no network charges, levies or taxes. "
        "Cleared auction prices where published, our forecast beyond them; the range is the forecast's P10 to P90 "
        f"band, not a guarantee. GBP converted at {EUR_PER_GBP} EUR per GBP."
    )
    missing = [z for z in names if z not in {r["zone"] for r in rows}]
    if missing:
        note += f" No prices cover the window for {', '.join(missing)}, so {'it is' if len(missing) == 1 else 'they are'} left out."
    return {
        "generated_at": t.to_pydatetime(), "kw": kw, "hours": hours, "deadline": end.to_pydatetime(),
        "eur_per_gbp": EUR_PER_GBP, "zones": rows, "cheapest_zone": rows[0]["zone"] if rows else None, "note": note,
    }
