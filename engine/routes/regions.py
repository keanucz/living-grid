"""GET /regions: the 14 GB regions with modelled carbon intensity and generation mix, tonight's Agile price,
and wind paid to switch off in Scotland.

GB has one wholesale price, so regional differences are in carbon and in retail and network charges, not in
wholesale prices. Carbon intensity and mix are the Carbon Intensity API's regional model (modelled, not metered).
Agile comes from engine.household: published rates where released, our forecast beyond them.
"""

from datetime import datetime

import pandas as pd
from fastapi import APIRouter

from engine import data
from engine import household as hh
from engine.ghost_wind import boalf
from engine.schemas import RegionsResponse
from pipeline import static

router = APIRouter(tags=["unseen"])

REGIONAL = "carbon_intensity/regional"
REGIONAL_MIX = "carbon_intensity/regional_mix"
AS_OF_TOLERANCE = pd.Timedelta(hours=3)
GHOST_WIND_HOURS = 24
NOTE = ("Carbon intensity and generation mix are the Carbon Intensity API's regional model (modelled). "
        "GB has one wholesale price, so regions differ in carbon and in retail and network charges, not wholesale. "
        "Agile is a retail tariff incl. VAT: published rates where released, our forecast beyond them.")


def centroids() -> dict[str, tuple[float, float]]:
    out = {}
    for region, geom in static.region_geometries().items():
        p = geom.representative_point()
        out[region] = (round(p.x, 3), round(p.y, 3))
    return out


def _latest_per_region(df: pd.DataFrame | None, at: pd.Timestamp) -> tuple[pd.DataFrame, pd.Timestamp | None]:
    """Each region's newest row at or before `at`, within AS_OF_TOLERANCE of the newest such row overall."""
    if df is None or df.empty:
        return pd.DataFrame(), None
    df = df.assign(ts=pd.to_datetime(df["ts"], utc=True))
    df = df[df["ts"] <= at]
    if df.empty:
        return df, None
    newest = df["ts"].max()
    df = df[df["ts"] >= newest - AS_OF_TOLERANCE]
    return df.sort_values("ts").groupby("region").tail(1).set_index("region"), newest


def _agile(region: str, now: pd.Timestamp) -> dict:
    empty = {"agile_now_p_kwh": None, "agile_tonight_min_p_kwh": None, "agile_tonight_min_at": None,
             "agile_tonight_avg_p_kwh": None, "agile_kind": None}
    start, end = hh.tonight(now)
    try:
        table = hh.price_table(region, now, now.floor(hh.SLOT), end)
    except (ValueError, KeyError, FileNotFoundError):
        return empty
    if table.empty:
        return empty
    out = dict(empty)
    current = table[table.index == now.floor(hh.SLOT)]
    if len(current):
        out["agile_now_p_kwh"] = round(float(current["p50"].iloc[0]), 2)
    night = table[table.index >= start]
    if len(night):
        i = night["p50"].idxmin()
        out.update({
            "agile_tonight_min_p_kwh": round(float(night.loc[i, "p50"]), 2),
            "agile_tonight_min_at": i.to_pydatetime(),
            "agile_tonight_avg_p_kwh": round(float(night["p50"].mean()), 2),
            "agile_kind": "actual" if (night["kind"] == "actual").all() else "forecast",
        })
    return out


def _ghost_wind(at: pd.Timestamp) -> dict[str, float]:
    est = boalf.estimate(at - pd.Timedelta(hours=GHOST_WIND_HOURS), at)
    if est.empty:
        return {}
    return {r: round(float(v), 1) for r, v in est.groupby("region")["mwh"].sum().items()}


def build(at=None, now=None) -> dict:
    """The RegionsResponse body. `at` picks the carbon hour (default: latest); `now` the Agile clock (default: at,
    or the wall clock when at is not given)."""
    regional = boalf.read_live(REGIONAL)
    mix = boalf.read_live(REGIONAL_MIX)
    wall = hh.clock()
    at_ts = data.as_utc(at) if at is not None else wall
    carbon, carbon_at = _latest_per_region(regional, at_ts)
    mix_rows = pd.DataFrame()
    if mix is not None and len(mix) and carbon_at is not None:
        m = mix.assign(ts=pd.to_datetime(mix["ts"], utc=True))
        latest = carbon.reset_index()[["region", "ts"]] if len(carbon) else pd.DataFrame(columns=["region", "ts"])
        mix_rows = m.merge(latest, on=["region", "ts"])
    agile_now = data.as_utc(now) if now is not None else at_ts
    ghost = _ghost_wind(carbon_at or at_ts)
    cents = centroids()
    regions = []
    for region, name in hh.regions().items():
        c = carbon.loc[region] if len(carbon) and region in carbon.index else None
        fuels = mix_rows[mix_rows["region"] == region].sort_values("perc", ascending=False) if len(mix_rows) else []
        regions.append({
            "region": region,
            "name": name,
            "centroid": cents.get(region, (0.0, 0.0)),
            "carbon_gco2_kwh": None if c is None else round(float(c["intensity_gco2_kwh"]), 1),
            "carbon_index": None if c is None else str(c["index"]),
            "mix": [{"fuel": f.fuel, "perc": round(float(f.perc), 1)} for f in fuels.itertuples()] if len(fuels) else [],
            "carbon_kind": "modelled",
            **_agile(region, agile_now),
            "ghost_wind_mwh_24h": ghost.get(region) if region in boalf.mapped_regions() and ghost else None,
        })
    note = NOTE
    if carbon_at is None:
        note += " Regional carbon intensity has not been ingested yet."
    return {"at": (carbon_at or at_ts).to_pydatetime(), "regions": regions, "note": note}


@router.get("/regions", response_model=RegionsResponse)
def regions(at: datetime | None = None) -> dict:
    return build(at)
