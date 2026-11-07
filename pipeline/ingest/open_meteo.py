"""Open-Meteo weather at a few representative points per zone, one call for all points.

Two kinds, written to data/weather/{kind}.parquet:
  historical_forecast  historical-forecast-api (archived model output, not ERA5), for training
  live_forecast        forecast API, for the next days
Variables are Open-Meteo names: wind_speed_100m (m/s), temperature_2m (degC), shortwave_radiation (W/m2).
issued_at is the run time for live data. The historical API is stitched from model runs without a
recorded issue time, so there issued_at is assumed to be 00:00 UTC on the target day.
"""

import time

import httpx
import pandas as pd

from pipeline import cache, schemas

HISTORICAL = "https://historical-forecast-api.open-meteo.com/v1/forecast"
LIVE = "https://api.open-meteo.com/v1/forecast"
VARIABLES = ["wind_speed_100m", "temperature_2m", "shortwave_radiation"]
CHUNK_DAYS = 31

POINTS = [
    ("GB", "london", 51.5, -0.1),
    ("GB", "moray_firth", 58.1, -3.0),
    ("GB", "north_sea", 55.0, 1.5),
    ("FR", "paris", 48.85, 2.35),
    ("FR", "rhone", 44.0, 4.8),
    ("DE-LU", "hamburg", 53.55, 9.99),
    ("DE-LU", "munich", 48.14, 11.58),
    ("NL", "amsterdam", 52.37, 4.9),
    ("NL", "north_sea", 53.5, 4.5),
    ("BE", "brussels", 50.85, 4.35),
    ("NO2", "stavanger", 58.97, 5.73),
]


def _get(client: httpx.Client, url: str, params: dict) -> list[dict]:
    q = {
        "latitude": ",".join(str(p[2]) for p in POINTS),
        "longitude": ",".join(str(p[3]) for p in POINTS),
        "hourly": ",".join(VARIABLES),
        "wind_speed_unit": "ms",
        "timezone": "UTC",
        **params,
    }
    for attempt in range(4):
        r = client.get(url, params=q)
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(float(r.headers.get("Retry-After", 5 * 2**attempt)))
            continue
        r.raise_for_status()
        body = r.json()
        return body if isinstance(body, list) else [body]
    r.raise_for_status()


def _frame(locations: list[dict], issued_at) -> pd.DataFrame:
    if len(locations) != len(POINTS):
        raise ValueError(f"Open-Meteo returned {len(locations)} locations for {len(POINTS)} points")
    parts = []
    for (zone, point, _, _), loc in zip(POINTS, locations, strict=True):
        h = loc["hourly"]
        ts = pd.to_datetime(h["time"], utc=True)
        for v in VARIABLES:
            parts.append(pd.DataFrame({"ts": ts, "zone": zone, "point": point, "variable": v, "value": h[v]}))
    df = pd.concat(parts, ignore_index=True).dropna(subset=["value"])
    df["issued_at"] = issued_at if issued_at is not None else df["ts"].dt.floor("D")
    return df


def _finish(df: pd.DataFrame, kind: str) -> pd.DataFrame:
    return schemas.validate(df[schemas.WEATHER.names], f"weather/{kind}")


def _guard():
    if cache.offline():
        raise RuntimeError("LG_OFFLINE is set: Open-Meteo ingest needs the network")


def fetch_historical(start, end, client: httpx.Client | None = None) -> pd.DataFrame:
    _guard()
    start, end = pd.Timestamp(start), pd.Timestamp(end)
    own = client is None
    client = client or httpx.Client(timeout=120)
    parts = []
    try:
        for a in pd.date_range(start.normalize(), end.normalize(), freq=f"{CHUNK_DAYS}D"):
            b = min(a + pd.Timedelta(days=CHUNK_DAYS - 1), end.normalize())
            locs = _get(client, HISTORICAL, {"start_date": f"{a:%Y-%m-%d}", "end_date": f"{b:%Y-%m-%d}"})
            parts.append(_frame(locs, None))
    finally:
        if own:
            client.close()
    return _finish(pd.concat(parts, ignore_index=True), "historical_forecast")


def fetch_live(days: int = 3, client: httpx.Client | None = None, now=None) -> pd.DataFrame:
    _guard()
    issued = pd.Timestamp.now(tz="UTC") if now is None else pd.Timestamp(now)
    if issued.tzinfo is None:
        issued = issued.tz_localize("UTC")
    own = client is None
    client = client or httpx.Client(timeout=60)
    try:
        locs = _get(client, LIVE, {"forecast_days": days})
    finally:
        if own:
            client.close()
    return _finish(_frame(locs, issued.floor("h")), "live_forecast")


def fetch(start, end, client: httpx.Client | None = None) -> pd.DataFrame:
    """Ingest-registry entry point: the historical-forecast series."""
    return fetch_historical(start, end, client)


def write(df: pd.DataFrame, kind: str) -> str:
    name = f"weather/{kind}"
    if kind == "historical_forecast" and cache.exists(name):
        df = pd.concat([pd.read_parquet(cache.path(name)), df], ignore_index=True)
        df = df.drop_duplicates(["ts", "zone", "point", "variable"], keep="last")
    elif kind == "live_forecast" and cache.exists(name):
        # Keep every run: the as-issued history is what lets scoring show past forecasts.
        df = pd.concat([pd.read_parquet(cache.path(name)), df], ignore_index=True)
        df = df.drop_duplicates(["ts", "issued_at", "zone", "point", "variable"], keep="last")
    cache.write(name, schemas.validate(df.sort_values(["ts", "zone", "point", "variable"]), name))
    return name


def run(start, end) -> list[str]:
    return [write(fetch_historical(start, end), "historical_forecast")]
