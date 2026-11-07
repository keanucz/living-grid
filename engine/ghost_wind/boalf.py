"""Ghost wind estimate 1: MWh of wind switched off per GB region and hour, from accepted bids.

Input is the pipeline's data/boalf/wind_bids.parquet (ts, bm_unit, region, capacity_mw, mwh), built
from Elexon settled bid volumes on wind units. Only units hand-mapped to a region in
data/static/wind_farms.csv count towards a region; the rest are reported as unmapped so the screen
can say how much of the GB total the regional picture covers. Accepted bids include non-constraint
actions, so these are upper bounds on constraint curtailment: label them as estimates.

The wind_farms.csv stems and capacities are checked against the verified wind facts in
engine/reference/facts/wind.json by engine/tests/test_reference_loader.py.
"""

import pandas as pd

from pipeline import cache, static

BIDS = "boalf/wind_bids"
METHOD = "boalf"
SCOTLAND = ("N", "P")
COLUMNS = ["ts", "region", "region_name", "method", "mwh", "units", "kind"]


def load_bids() -> pd.DataFrame | None:
    try:
        return cache.read(BIDS)
    except FileNotFoundError:
        return None


def _region_names() -> dict[str, str]:
    keys = static.gb_region_keys()
    return dict(zip(keys["region"], keys["name"], strict=True))


def mapped_regions() -> list[str]:
    return sorted(static.wind_farms()["region"].dropna().unique())


def _utc(t) -> pd.Timestamp:
    t = pd.Timestamp(t)
    return t.tz_localize("UTC") if t.tzinfo is None else t.tz_convert("UTC")


def _window(bids: pd.DataFrame, start, end) -> pd.DataFrame:
    ts = pd.to_datetime(bids["ts"], utc=True)
    keep = pd.Series(True, index=bids.index)
    if start is not None:
        keep &= ts >= _utc(start).floor("h")
    if end is not None:
        keep &= ts <= _utc(end)
    return bids[keep].assign(ts=ts[keep])


def by_region(bids: pd.DataFrame, start=None, end=None, regions=None) -> pd.DataFrame:
    """Hourly MWh switched off per mapped region. Hours with no accepted bids are 0, not missing,
    over [start, end] (or the span of the data)."""
    bids = _window(bids, start, end)
    regions = list(regions or mapped_regions())
    lo = _utc(start).floor("h") if start is not None else (bids["ts"].min() if len(bids) else None)
    hi = pd.Timestamp(end) if end is not None else (bids["ts"].max() if len(bids) else None)
    if lo is None or hi is None:
        return pd.DataFrame(columns=COLUMNS)
    hours = pd.date_range(_utc(lo), _utc(hi), freq="h")
    mapped = bids[bids["region"].isin(regions)]
    agg = mapped.groupby(["ts", "region"]).agg(mwh=("mwh", "sum"), units=("bm_unit", "nunique"))
    grid = pd.MultiIndex.from_product([hours, regions], names=["ts", "region"])
    out = agg.reindex(grid, fill_value=0).reset_index()
    names = _region_names()
    out["region_name"] = out["region"].map(names)
    out["method"] = METHOD
    out["kind"] = "estimated"
    out["mwh"] = out["mwh"].astype(float)
    out["units"] = out["units"].astype(int)
    return out[COLUMNS]


def coverage(bids: pd.DataFrame, start=None, end=None) -> dict:
    """How much of the GB wind-bid total the mapped regions explain."""
    bids = _window(bids, start, end)
    total = float(bids["mwh"].sum())
    mapped = float(bids.loc[bids["region"].notna(), "mwh"].sum())
    scotland = float(bids.loc[bids["region"].isin(SCOTLAND), "mwh"].sum())
    return {
        "total_mwh": total,
        "mapped_mwh": mapped,
        "unmapped_mwh": total - mapped,
        "scotland_mwh": scotland,
        "mapped_share": mapped / total if total else 0.0,
    }


def estimate(start=None, end=None, bids: pd.DataFrame | None = None) -> pd.DataFrame:
    """by_region over the cached bids; an empty frame when no bids have been ingested."""
    bids = load_bids() if bids is None else bids
    if bids is None:
        return pd.DataFrame(columns=COLUMNS)
    return by_region(bids, start, end)
