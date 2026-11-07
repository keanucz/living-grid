"""Open-Meteo hourly wind and sun on a regular grid over our zones, for the map overlays.

Written to data/weather_grid/hourly.parquet, one row per (ts, lat, lon):
  wind_speed_100m (m/s), wind_dir_100m (degrees the wind blows FROM), shortwave_radiation (W/m2).
The past comes from the forecast API's past_days (archived model analysis), the future from its forecast
hours, so every value is model output (modelled), not a measurement. The grid is 0.5 degrees over land and sea
that matters to the six v1 zones plus the North Sea.
"""

import time

import httpx
import numpy as np
import pandas as pd

from pipeline import cache

URL = "https://api.open-meteo.com/v1/forecast"
NAME = "weather_grid/hourly"
FIXTURE_NAME = "weather_grid/hourly"
VARIABLES = ["wind_speed_100m", "wind_direction_100m", "shortwave_radiation"]
COLUMNS = ["wind_speed_100m", "wind_dir_100m", "shortwave_radiation"]
STEP = 0.5
LAT = (43.0, 62.0)
LON = (-11.0, 14.0)
CHUNK = 100
PAST_DAYS = 7
FUTURE_DAYS = 2

# Rectangles (lon_min, lon_max, lat_min, lat_max) that make up the covered area.
BOXES = [
    (-11.0, 2.0, 49.5, 61.5),   # GB, Ireland, North Sea west
    (-5.0, 8.5, 43.0, 51.5),    # France
    (2.5, 14.0, 47.0, 55.5),    # Benelux, Germany
    (2.0, 14.0, 55.5, 62.0),    # North Sea east, southern Norway
]


def grid() -> pd.DataFrame:
    lats = np.arange(LAT[0], LAT[1] + 1e-9, STEP)
    lons = np.arange(LON[0], LON[1] + 1e-9, STEP)
    la, lo = np.meshgrid(lats, lons, indexing="ij")
    pts = pd.DataFrame({"lat": la.ravel(), "lon": lo.ravel()})
    keep = np.zeros(len(pts), bool)
    for x0, x1, y0, y1 in BOXES:
        keep |= (pts.lon >= x0) & (pts.lon <= x1) & (pts.lat >= y0) & (pts.lat <= y1)
    return pts[keep].reset_index(drop=True)


def _get(client: httpx.Client, pts: pd.DataFrame, days_back: int, days_ahead: int) -> list[dict]:
    q = {
        "latitude": ",".join(f"{v:g}" for v in pts.lat),
        "longitude": ",".join(f"{v:g}" for v in pts.lon),
        "hourly": ",".join(VARIABLES),
        "wind_speed_unit": "ms",
        "timezone": "UTC",
        "past_days": days_back,
        "forecast_days": days_ahead,
    }
    for attempt in range(4):
        r = client.get(URL, params=q)
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(float(r.headers.get("Retry-After", 5 * 2**attempt)))
            continue
        r.raise_for_status()
        body = r.json()
        return body if isinstance(body, list) else [body]
    r.raise_for_status()


def fetch(past_days: int = PAST_DAYS, future_days: int = FUTURE_DAYS, client: httpx.Client | None = None) -> pd.DataFrame:
    if cache.offline():
        raise RuntimeError("LG_OFFLINE is set: weather grid ingest needs the network")
    pts = grid()
    own = client is None
    client = client or httpx.Client(timeout=120)
    parts = []
    try:
        for i in range(0, len(pts), CHUNK):
            chunk = pts.iloc[i : i + CHUNK]
            locs = _get(client, chunk, past_days, future_days)
            if len(locs) != len(chunk):
                raise ValueError(f"Open-Meteo returned {len(locs)} locations for {len(chunk)} points")
            for (_, p), loc in zip(chunk.iterrows(), locs, strict=True):
                h = loc["hourly"]
                parts.append(pd.DataFrame({
                    "ts": pd.to_datetime(h["time"], utc=True),
                    "lat": p.lat, "lon": p.lon,
                    "wind_speed_100m": h["wind_speed_100m"],
                    "wind_dir_100m": h["wind_direction_100m"],
                    "shortwave_radiation": h["shortwave_radiation"],
                }))
            time.sleep(1)
    finally:
        if own:
            client.close()
    return _finish(pd.concat(parts, ignore_index=True))


def _finish(df: pd.DataFrame) -> pd.DataFrame:
    df = df.dropna(subset=COLUMNS).copy()
    df[["lat", "lon"]] = df[["lat", "lon"]].astype("float32")
    for c in COLUMNS:
        df[c] = df[c].astype("float32")
    return df.sort_values(["ts", "lat", "lon"]).reset_index(drop=True)


def write(df: pd.DataFrame) -> str:
    if cache.exists(NAME):
        df = cache.concat([cache.read_file(cache.path(NAME)), df], ignore_index=True)
        df = df.drop_duplicates(["ts", "lat", "lon"], keep="last")
    cache.write(NAME, _finish(df))
    return NAME


def run(start=None, end=None) -> list[str]:
    return [write(fetch())]


def synthetic(start="2026-11-05", hours=96) -> pd.DataFrame:
    """Deterministic stand-in for the offline fixture: a moving low over the North Sea. Not real weather."""
    pts = grid()
    ts = pd.date_range(pd.Timestamp(start, tz="UTC"), periods=hours, freq="h")
    rows = []
    for k, t in enumerate(ts):
        cx, cy = -2.0 + 0.2 * k, 57.0 - 0.05 * k
        dx, dy = pts.lon.to_numpy() - cx, pts.lat.to_numpy() - cy
        r = np.hypot(dx, dy)
        speed = 4.0 + 14.0 * np.exp(-((r / 6.0) ** 2))
        direction = (np.degrees(np.arctan2(dx, dy)) + 270.0) % 360.0
        sun = max(0.0, np.sin((t.hour - 6) / 12 * np.pi)) * 220.0 * (1 - 0.6 * np.exp(-((r / 8.0) ** 2)))
        rows.append(pd.DataFrame({
            "ts": t, "lat": pts.lat, "lon": pts.lon, "wind_speed_100m": speed.round(1),
            "wind_dir_100m": direction.round(0), "shortwave_radiation": np.round(sun, 0),
        }))
    return _finish(pd.concat(rows, ignore_index=True))
