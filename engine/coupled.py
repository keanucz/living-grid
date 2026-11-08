"""Today's day-ahead prices for the coupled market around Britain: 16 Nord Pool zones, prices only, no forecast.

One request to the Nord Pool data portal returns every zone's quarter-hour prices for the delivery day; they are
averaged to hours and cached to data/coupled/<date>.parquet. A fetch happens at most every REFRESH per day; when it
fails the last cache is served. With LG_OFFLINE=1 the cache is served, or the committed contract fixture when there
is none.
"""

import logging
import threading
import time
from datetime import date, datetime, timezone

import httpx
import pandas as pd

from pipeline import cache

log = logging.getLogger("engine.coupled")

URL = "https://dataportal-api.nordpoolgroup.com/api/DayAheadPrices"
SOURCE = "Nord Pool day-ahead (dataportal-api.nordpoolgroup.com)"
NOTE = "Prices only, not forecast. Zone borders approximate."
UNIT = "EUR/MWh"
REFRESH_S = 15 * 60
TIMEOUT_S = 10

ZONES = {
    "DK1": ("Denmark west", "Denmark"),
    "DK2": ("Denmark east", "Denmark"),
    "SE1": ("Sweden north", "Sweden"),
    "SE2": ("Sweden north-central", "Sweden"),
    "SE3": ("Sweden central", "Sweden"),
    "SE4": ("Sweden south", "Sweden"),
    "FI": ("Finland", "Finland"),
    "NO1": ("Norway east", "Norway"),
    "NO3": ("Norway middle", "Norway"),
    "NO4": ("Norway north", "Norway"),
    "NO5": ("Norway west", "Norway"),
    "EE": ("Estonia", "Estonia"),
    "LV": ("Latvia", "Latvia"),
    "LT": ("Lithuania", "Lithuania"),
    "AT": ("Austria", "Austria"),
    "PL": ("Poland", "Poland"),
}

_lock = threading.Lock()


class Unavailable(LookupError):
    pass


def name(day: date) -> str:
    return f"coupled/{day.isoformat()}"


def parse(payload: dict) -> pd.DataFrame:
    """Hourly mean price per zone from a DayAheadPrices payload: ts (UTC hour), zone, value."""
    rows = [
        {"ts": e["deliveryStart"], "zone": z, "value": p}
        for e in payload.get("multiAreaEntries", [])
        for z, p in e.get("entryPerArea", {}).items()
        if z in ZONES and p is not None
    ]
    if not rows:
        return pd.DataFrame({"ts": pd.Series(dtype="datetime64[ns, UTC]"), "zone": pd.Series(dtype=str), "value": pd.Series(dtype=float)})
    df = pd.DataFrame(rows)
    df["ts"] = pd.to_datetime(df["ts"], utc=True).dt.floor("h")
    return df.groupby(["ts", "zone"], as_index=False)["value"].mean()


def fetch(day: date, client: httpx.Client | None = None) -> pd.DataFrame:
    params = {"date": day.isoformat(), "market": "DayAhead", "deliveryArea": ",".join(ZONES), "currency": "EUR"}
    own = client is None
    client = client or httpx.Client(timeout=TIMEOUT_S, headers={"User-Agent": "living-grid"})
    try:
        r = client.get(URL, params=params)
        if r.status_code in (204, 404):
            raise Unavailable(f"Nord Pool has no coupled prices for {day} yet")
        r.raise_for_status()
        return parse(r.json())
    finally:
        if own:
            client.close()


def _age_s(day: date) -> float | None:
    p = cache.path(name(day))
    return time.time() - p.stat().st_mtime if p.exists() else None


def hourly(day: date, client: httpx.Client | None = None) -> tuple[pd.DataFrame, datetime]:
    """(hourly prices, when they were fetched) for the delivery day, from the cache or a fresh fetch."""
    with _lock:
        age = _age_s(day)
        if cache.offline():
            if age is None:
                raise Unavailable("offline and no cached coupled prices")
        elif age is None or age > REFRESH_S:
            try:
                df = fetch(day, client)
                if len(df):
                    cache.write(name(day), df)
                    age = 0.0
            except (httpx.HTTPError, ValueError, Unavailable) as e:
                log.warning("coupled fetch for %s failed: %s", day, e)
                if age is None:
                    raise Unavailable(str(e)) from e
        df = cache.read_file(cache.path(name(day)))
        fetched = datetime.fromtimestamp(cache.path(name(day)).stat().st_mtime, tz=timezone.utc)
        return df, fetched


def response(df: pd.DataFrame, day: date, at: pd.Timestamp, as_of: datetime) -> dict:
    hour = at.floor("h")
    zones = []
    for z, (label, country) in ZONES.items():
        s = df[df["zone"] == z].set_index("ts")["value"]
        if s.empty:
            continue
        now = s.get(hour)
        zones.append({"zone": z, "name": label, "country": country,
                      "price": None if now is None or pd.isna(now) else round(float(now), 2),
                      "day_avg": round(float(s.mean()), 2), "day_min": round(float(s.min()), 2), "day_max": round(float(s.max()), 2)})
    return {"as_of": as_of, "delivery_date": day, "hour_utc": hour.to_pydatetime(), "unit": UNIT, "source": SOURCE,
            "note": NOTE, "zones": zones}


def delivery_day(at: pd.Timestamp) -> date:
    """Nord Pool delivery days are CET calendar days (23:00 to 23:00 UTC in winter)."""
    return (at.tz_convert("Europe/Berlin")).date()
