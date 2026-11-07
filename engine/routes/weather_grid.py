"""GET /weather/grid?t=: one hour of modelled wind and sun on the 0.5 degree grid, as compact arrays.

Values come from Open-Meteo model output (analysis for the past, forecast for the future), not measurements.
Arrays are in the order of `lats`/`lons` of the grid (row i is the point lats[i], lons[i]); wind speed in tenths
of m/s, direction in whole degrees, shortwave radiation in whole W/m2, so one hour stays far below 300 KB.
"""

from datetime import datetime
from functools import lru_cache

import pandas as pd
from fastapi import APIRouter, HTTPException

from engine import data
from engine.schemas import WeatherGridResponse
from pipeline import cache
from pipeline.ingest import weather_grid as wg

router = APIRouter(tags=["weather"])
FALLBACK_NOTE = "SYNTHETIC placeholder weather (nothing ingested yet), not real data."

SOURCE = "Open-Meteo (model analysis and forecast, https://open-meteo.com), 100 m wind and shortwave radiation"
NOTE = "Modelled weather on a 0.5 degree grid, not measurements."


@lru_cache(maxsize=4)
def _load(mtime: float) -> pd.DataFrame:
    return cache.read_file(cache.path(wg.NAME)) if mtime else wg.synthetic()


def _frame() -> tuple[pd.DataFrame, bool]:
    p = cache.path(wg.NAME)
    return _load(p.stat().st_mtime if p.exists() else 0.0), p.exists()


def build(t=None) -> dict:
    df, real = _frame()
    hours = df["ts"].drop_duplicates().sort_values()
    if t is None:
        now = pd.Timestamp.now(tz="UTC").floor("h")
        at = hours[hours <= now].max() if (hours <= now).any() else hours.iloc[0]
    else:
        at = data.as_utc(t).floor("h")
    if at not in set(hours):
        raise HTTPException(404, f"no weather grid for {at.isoformat()}; have {hours.min().isoformat()} to {hours.max().isoformat()}")
    h = df[df["ts"] == at].sort_values(["lat", "lon"])
    return {
        "ts": at.to_pydatetime(),
        "available_from": hours.min().to_pydatetime(),
        "available_to": hours.max().to_pydatetime(),
        "step_deg": wg.STEP,
        "lats": [round(float(v), 2) for v in h["lat"]],
        "lons": [round(float(v), 2) for v in h["lon"]],
        "wind_speed_dms": [int(round(v * 10)) for v in h["wind_speed_100m"]],
        "wind_dir_deg": [int(round(v)) % 360 for v in h["wind_dir_100m"]],
        "shortwave_wm2": [int(round(v)) for v in h["shortwave_radiation"]],
        "units": {"wind_speed_dms": "tenths of m/s at 100 m", "wind_dir_deg": "degrees the wind blows from",
                  "shortwave_wm2": "W/m2"},
        "kind": "modelled" if real else "synthetic",
        "source": SOURCE,
        "note": NOTE if real else FALLBACK_NOTE,
    }


@router.get("/weather/grid", response_model=WeatherGridResponse)
def weather_grid(t: datetime | None = None) -> dict:
    return build(t)
