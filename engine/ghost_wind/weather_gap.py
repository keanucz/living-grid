"""Ghost wind estimate 2: weather-implied wind output minus metered output, per region and hour.

Each mapped farm in data/static/wind_farms.csv gets the wind speed at its nearest Open-Meteo point
(or the zone average when the weather has no point coordinates), scaled from 100 m to hub height,
run through a generic power curve and multiplied by capacity and availability. Subtracting what
was metered gives energy the wind could have produced but did not; clipped at zero and labelled
modelled. It overstates curtailment wherever the generic curve, the point weather or the
availability assumption is off, which is why it is shown next to the accepted-bids estimate.
"""

import math

import numpy as np
import pandas as pd

from engine.reference import loader as facts
from pipeline import static

METHOD = "weather_gap"
COLUMNS = ["ts", "region", "region_name", "method", "implied_mwh", "metered_mwh", "mwh", "farms", "kind"]

# Verified facts (engine/reference/facts/wind.json): a generic modern turbine, not any one model.
CUT_IN_MS = facts.figure("wind_power_curve", after="cut-in")
RATED_MS = facts.figure("wind_power_curve", after="rated")  # low end of the 12 to 13 m/s range
CUT_OUT_MS = facts.figure("wind_power_curve", after="cut-out")
SHEAR_ALPHA = facts.figure("wind_shear_exponent", after="over sea")  # most mapped capacity is offshore
# Modelling assumptions with no verified source; stated on screen through kind="modelled".
HUB_HEIGHT_M = 110.0
AVAILABILITY = 0.92  # share of capacity not out for maintenance or faults


def power_curve(ws: np.ndarray | pd.Series | float) -> np.ndarray:
    """Capacity factor (0 to 1) at hub-height wind speed in m/s: zero below cut-in and from cut-out,
    cubic between cut-in and rated, flat at 1 up to cut-out."""
    v = np.asarray(ws, dtype=float)
    ramp = (v**3 - CUT_IN_MS**3) / (RATED_MS**3 - CUT_IN_MS**3)
    cf = np.where(v < CUT_IN_MS, 0.0, np.where(v < RATED_MS, ramp, np.where(v < CUT_OUT_MS, 1.0, 0.0)))
    return np.where(np.isfinite(v), np.clip(cf, 0.0, 1.0), np.nan)


def to_hub_height(ws_100m, hub_height_m: float = HUB_HEIGHT_M):
    return np.asarray(ws_100m, dtype=float) * (hub_height_m / 100.0) ** SHEAR_ALPHA


def _point_coords() -> dict[str, tuple[float, float]]:
    from pipeline.ingest.open_meteo import POINTS

    return {f"{zone}:{point}": (lat, lon) for zone, point, lat, lon in POINTS}


def _latest_issue(weather: pd.DataFrame) -> pd.DataFrame:
    w = weather[weather["variable"] == "wind_speed_100m"].copy()
    w["ts"] = pd.to_datetime(w["ts"], utc=True)
    w = w.sort_values("issued_at").drop_duplicates(["zone", "point", "ts"], keep="last")
    return w[["ts", "zone", "point", "value"]]


def _distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    (la1, lo1), (la2, lo2) = a, b
    return math.hypot(la1 - la2, (lo1 - lo2) * math.cos(math.radians((la1 + la2) / 2)))


def farm_wind(weather: pd.DataFrame, farms: pd.DataFrame, zone: str = "GB") -> pd.DataFrame:
    """Hourly 100 m wind speed per farm: ts, bm_unit, ws_100m."""
    w = _latest_issue(weather[weather["zone"] == zone])
    coords = {p: c for p, c in _point_coords().items() if p.startswith(f"{zone}:")}
    have = {p.split(":", 1)[1]: c for p, c in coords.items() if p.split(":", 1)[1] in set(w["point"])}
    zone_mean = w.groupby("ts")["value"].mean()
    out = []
    for f in farms.itertuples():
        if have and pd.notna(f.lat) and pd.notna(f.lon):
            point = min(have, key=lambda p: _distance((f.lat, f.lon), have[p]))
            s = w[w["point"] == point].set_index("ts")["value"]
        else:
            s = zone_mean
        out.append(pd.DataFrame({"ts": s.index, "bm_unit": f.bm_unit, "ws_100m": s.to_numpy()}))
    return pd.concat(out, ignore_index=True) if out else pd.DataFrame(columns=["ts", "bm_unit", "ws_100m"])


def implied_output(weather: pd.DataFrame, farms: pd.DataFrame | None = None) -> pd.DataFrame:
    """Hourly weather-implied MWh per farm: ts, bm_unit, region, capacity_mw, ws_hub, implied_mwh."""
    farms = static.wind_farms() if farms is None else farms
    farms = farms.dropna(subset=["region", "capacity_mw"])
    ws = farm_wind(weather, farms).merge(farms[["bm_unit", "region", "capacity_mw"]], on="bm_unit")
    ws["ws_hub"] = to_hub_height(ws["ws_100m"])
    ws["implied_mwh"] = power_curve(ws["ws_hub"]) * ws["capacity_mw"] * AVAILABILITY
    return ws[["ts", "bm_unit", "region", "capacity_mw", "ws_hub", "implied_mwh"]].dropna(subset=["implied_mwh"])


def gap(implied: pd.DataFrame, metered: pd.DataFrame) -> pd.DataFrame:
    """Per region and hour: implied minus metered, clipped at zero.

    metered: ts, bm_unit, mwh (hourly metered output, units named by stem or full BM unit id).
    Hours where a farm has no metered value are dropped rather than counted as fully curtailed.
    """
    m = metered.copy()
    m["ts"] = pd.to_datetime(m["ts"], utc=True)
    m["bm_unit"] = m["bm_unit"].str.rsplit("-", n=1).str[0]
    m = m.groupby(["ts", "bm_unit"], as_index=False)["mwh"].sum().rename(columns={"mwh": "metered_mwh"})
    j = implied.merge(m, on=["ts", "bm_unit"], how="inner")
    j["farm_gap"] = (j["implied_mwh"] - j["metered_mwh"]).clip(lower=0.0)
    agg = j.groupby(["ts", "region"], as_index=False).agg(
        implied_mwh=("implied_mwh", "sum"), metered_mwh=("metered_mwh", "sum"),
        mwh=("farm_gap", "sum"), farms=("bm_unit", "nunique"),
    )
    keys = static.gb_region_keys()
    agg["region_name"] = agg["region"].map(dict(zip(keys["region"], keys["name"], strict=True)))
    agg["method"] = METHOD
    agg["kind"] = "modelled"
    agg["farms"] = agg["farms"].astype(int)
    return agg[COLUMNS].sort_values(["ts", "region"]).reset_index(drop=True)


def estimate(weather: pd.DataFrame, metered: pd.DataFrame | None, farms: pd.DataFrame | None = None) -> pd.DataFrame:
    """The weather-gap estimate, or an empty frame when no metered output is available."""
    if metered is None or metered.empty:
        return pd.DataFrame(columns=COLUMNS)
    return gap(implied_output(weather, farms), metered)
