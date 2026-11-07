"""Monday's frozen day-ahead forecast against the auction results as they land.

Only a real freeze counts: online, the committed fixture is never served as if it were our forecast.
"""

import pandas as pd
from fastapi import APIRouter, HTTPException

from engine import data
from engine.schemas import RevealResponse
from pipeline import cache

router = APIRouter(tags=["proof"])

FROZEN = "forecasts/frozen_monday"
RESULTS = "reveal/results"
INSIDE_BAND_ZONE = 0.8  # a zone counts as "inside the band" when at least this share of its hours is


def _read(name: str) -> pd.DataFrame | None:
    if cache.exists(name):
        return pd.read_parquet(cache.path(name))
    if cache.offline():
        try:
            return cache.read(name)
        except FileNotFoundError:
            return None
    return None


def _results(start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
    """Latest observed day-ahead price per (zone, ts): the reveal poller first, then cached actuals."""
    parts = []
    r = _read(RESULTS)
    if r is not None and len(r):
        parts.append(r.sort_values("seen_at").groupby(["zone", "ts"], as_index=False).last()[["zone", "ts", "value"]].assign(rank=0))
    a = data.actuals()
    a = a[(a["series"] == "price_da") & (a["ts"] >= start) & (a["ts"] < end)]
    if len(a):
        a = a.assign(rank=a["source"].map({s: i + 1 for i, s in enumerate(data.PRICE_SOURCES)}).fillna(9))
        parts.append(a[["zone", "ts", "value", "rank"]])
    if not parts:
        return pd.DataFrame(columns=["zone", "ts", "value"])
    out = pd.concat(parts, ignore_index=True)
    out = out[(out["ts"] >= start) & (out["ts"] < end)]
    return out.sort_values("rank").groupby(["zone", "ts"], as_index=False).first()[["zone", "ts", "value"]]


def build() -> dict:
    frozen = _read(FROZEN)
    if frozen is None or frozen.empty:
        raise HTTPException(404, "Monday's forecast is not frozen yet; the first freeze is at 23:59 UTC on Saturday.")
    frozen_at = frozen["frozen_at"].max()
    f = frozen[frozen["frozen_at"] == frozen_at]
    start, end = f["ts"].min(), f["ts"].max() + pd.Timedelta(hours=1)
    res = _results(start, end).set_index(["zone", "ts"])["value"]

    zones, maes, inside_zones = [], [], 0
    for zone in data.ZONES:
        g = f[f["zone"] == zone].sort_values("ts")
        if g.empty:
            continue
        hours, errs, inside = [], [], []
        for r in g.itertuples():
            actual = res.get((zone, r.ts))
            actual = None if actual is None or pd.isna(actual) else float(actual)
            hours.append({"ts": r.ts.to_pydatetime(), "p10": r.p10, "p50": r.p50, "p90": r.p90, "actual": actual})
            if actual is not None:
                errs.append(abs(actual - r.p50))
                inside.append(r.p10 <= actual <= r.p90)
        published = len(errs) == len(hours)
        mae = round(sum(errs) / len(errs), 2) if errs else None
        share = round(sum(inside) / len(inside), 2) if inside else None
        if published:
            maes.append(mae)
            inside_zones += share >= INSIDE_BAND_ZONE
        zones.append(
            {"zone": zone, "currency": data.CURRENCY[zone], "published": published, "hours": hours, "mae": mae, "inside_band_share": share}
        )
    mid = f["ts"].min() + (end - f["ts"].min()) / 2
    return {
        "delivery_date": mid.tz_convert("Europe/Berlin").date(),
        "frozen_at": frozen_at.to_pydatetime(),
        "zones": zones,
        "zones_published": len(maes),
        "mean_abs_error": round(sum(maes) / len(maes), 2) if maes else None,
        "zones_inside_band": inside_zones if maes else None,
    }


@router.get("/reveal", response_model=RevealResponse)
def reveal() -> dict:
    return build()
