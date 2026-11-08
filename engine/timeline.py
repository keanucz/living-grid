"""Compact history for the scrubber strip: per-zone series over any range since the start of the cache.

The hourly panel (price, wind and solar share, carbon, net imports) is built once per set of cache files and
reused, so a year at daily steps is a slice and a resample, not a scan of the raw actuals.
"""

import json
from functools import lru_cache

import numpy as np
import pandas as pd

from engine import data
from pipeline import cache

SERIES = ["price", "wind_share", "solar_share", "carbon", "net_import_mw"]
MAX_HOURLY_POINTS = 24 * 120
NOTE = (
    "Prices are day-ahead; GB before September 2026 is the Elexon market index, a traded reference rather than "
    "the N2EX auction result. Shares and net imports are metered; carbon is modelled. GB has no solar series."
)


def _signature() -> tuple:
    files = [(s, p, p.stat().st_mtime) for s, p in sorted(data._files("actuals").items())]
    c = data._files("carbon").get("consumption_intensity")
    return tuple(files), (c, c.stat().st_mtime) if c else None


def _hourly(df: pd.DataFrame) -> pd.DataFrame:
    return df.groupby(["ts", "zone"])["value"].mean().unstack("zone")


@lru_cache(maxsize=2)
def _build(sig: tuple) -> dict:
    a = data.actuals()
    a = a[a["series"].isin(["price_da", "load"]) | a["series"].str.startswith(("gen_", "flow_GB_"))
          | a["series"].str.startswith("flow_net_")]

    p = a[a["series"] == "price_da"].copy()
    p["rank"] = p["source"].map({s: i for i, s in enumerate(data.PRICE_SOURCES)}).fillna(len(data.PRICE_SOURCES))
    p = p.sort_values(["ts", "zone", "rank"]).drop_duplicates(["ts", "zone"])
    price = p.pivot(index="ts", columns="zone", values="value")
    proxy = p.assign(v=(p["source"] == "mid")).pivot(index="ts", columns="zone", values="v").fillna(False).astype(bool)

    g = a[a["series"].str.startswith("gen_") & ~a["series"].str.endswith("_consumption")]
    total = _hourly(g.groupby(["ts", "zone", "source"], as_index=False)["value"].sum().groupby(["ts", "zone"], as_index=False)["value"].max())
    wind = _hourly(g[g["series"].str.startswith("gen_wind")].groupby(["ts", "zone"], as_index=False)["value"].sum())
    solar = _hourly(g[g["series"] == "gen_solar"])

    f = a[a["series"].str.startswith("flow_GB_")].groupby("ts")["value"].sum()
    net = _hourly(a[a["series"].str.startswith("flow_net_")])
    net["GB"] = -f

    c = data.carbon()
    carbon = c.pivot_table(index="ts", columns="zone", values="consumption_gco2_kwh") if len(c) else pd.DataFrame()
    out = {
        "price": price,
        "price_proxy": proxy,
        "wind_share": wind / total,
        "solar_share": solar / total,
        "carbon": carbon,
        "net_import_mw": net,
    }
    out["coverage"] = _coverage(out)
    for k in [*SERIES, "price_proxy"]:
        df = out[k].astype(float)
        out[k + "_day"] = df.resample("D").max() if k == "price_proxy" else df.resample("D").mean()
    return out


def panel() -> dict:
    return _build(_signature())


def _events(lo: pd.Timestamp, hi: pd.Timestamp) -> list[dict]:
    p = cache.DATA / "events" / "index.json"
    if cache.offline() or not p.exists():
        p = cache.ROOT / "data" / "events" / "index.json"
    if not p.exists():
        return []
    out = []
    for e in json.loads(p.read_text())["events"]:
        start, end = data.as_utc(e["start"]), data.as_utc(e["end"])
        if end >= lo and start <= hi:
            out.append({k: e[k] for k in ("slug", "title", "kind", "headline", "replay_available")} | {"start": start, "end": end})
    return out


def _coverage(pn: dict) -> dict:
    out = {}
    for s in SERIES:
        df = pn[s]
        full = max(len(pd.date_range(df.index.min(), df.index.max(), freq="h")), 1) if len(df) else 1
        out[s] = {
            z: {
                "first": df[z].first_valid_index(),
                "last": df[z].last_valid_index(),
                "share": round(float(df[z].count()) / full, 3),
            }
            for z in df.columns
        }
    return out


def _clean(a: np.ndarray) -> list[float | None]:
    return [None if not np.isfinite(v) else round(float(v), 4) for v in a]


def build(lo, hi, step: str) -> dict:
    lo, hi = data.as_utc(lo).floor("h"), data.as_utc(hi).floor("h")
    if hi < lo:
        raise ValueError("'to' is before 'from'")
    if step == "day":
        lo, hi = lo.floor("D"), hi.floor("D")
    idx = pd.date_range(lo, hi, freq="D" if step == "day" else "h")
    if step == "hour" and len(idx) > MAX_HOURLY_POINTS:
        raise ValueError(f"step=hour is limited to {MAX_HOURLY_POINTS // 24} days; use step=day")
    pn = panel()
    zones = {}
    for z in data.ZONES:
        row = {}
        for s in [*SERIES, "price_proxy"]:
            df = pn[s + "_day" if step == "day" else s]
            if z not in df.columns:
                row[s] = [False] * len(idx) if s == "price_proxy" else [None] * len(idx)
                continue
            w = df[z][(df.index >= lo) & (df.index < idx[-1] + (pd.Timedelta(days=1) if step == "day" else pd.Timedelta(hours=1)))]
            w = w.reindex(idx)
            row[s] = [bool(v) for v in w.fillna(0)] if s == "price_proxy" else _clean(w.to_numpy(dtype=float))
        zones[z] = row
    return {
        "from": lo.to_pydatetime(),
        "to": hi.to_pydatetime(),
        "step": step,
        "ts": [t.to_pydatetime() for t in idx],
        "zones": zones,
        "events": _events(lo, hi),
        "coverage": pn["coverage"],
        "note": NOTE,
    }
