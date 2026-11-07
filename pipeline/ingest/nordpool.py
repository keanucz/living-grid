"""Nord Pool data portal day-ahead prices (keyless, about 60 days of history).

Series price_da, hourly UTC. Continental zones come from market DayAhead (15-minute, averaged to
hourly, EUR/MWh); GB comes from N2EX_DayAhead (hourly, GBP/MWh). Days not yet published (HTTP 204)
are skipped, so polling for a result simply returns fewer rows until it lands.
"""

import time

import httpx
import pandas as pd

from pipeline import cache, schemas

BASE = "https://dataportal-api.nordpoolgroup.com/api/DayAheadPrices"
MARKETS = [
    {"market": "DayAhead", "deliveryArea": "FR,NL,BE,NO2,GER", "currency": "EUR"},
    {"market": "N2EX_DayAhead", "deliveryArea": "UK", "currency": "GBP"},
]
AREAS = {"FR": "FR", "NL": "NL", "BE": "BE", "NO2": "NO2", "GER": "DE-LU", "UK": "GB"}


def _get(client: httpx.Client, params: dict) -> dict | None:
    for attempt in range(4):
        r = client.get(BASE, params=params)
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(float(r.headers.get("Retry-After", 2**attempt)))
            continue
        if r.status_code in (204, 404):
            return None
        r.raise_for_status()
        return r.json()
    r.raise_for_status()


def _rows(payload: dict, currency: str) -> list[dict]:
    return [
        {"ts": e["deliveryStart"], "zone": AREAS[area], "value": price, "unit": f"{currency}/MWh"}
        for e in payload["multiAreaEntries"]
        for area, price in e["entryPerArea"].items()
        if area in AREAS and price is not None
    ]


def fetch(start, end, client: httpx.Client | None = None) -> pd.DataFrame:
    """Day-ahead prices with start <= ts <= end, as a validated actuals frame."""
    if cache.offline():
        raise RuntimeError("LG_OFFLINE is set: Nord Pool ingest needs the network")
    start, end = pd.Timestamp(start), pd.Timestamp(end)
    own = client is None
    client = client or httpx.Client(timeout=60, headers={"User-Agent": "living-grid"})
    rows = []
    try:
        # The delivery date is CET, so UTC day D lives in delivery dates D and D+1.
        for day in pd.date_range(start.normalize(), end.normalize() + pd.Timedelta(days=1), freq="D"):
            for m in MARKETS:
                payload = _get(client, {**m, "date": f"{day:%Y-%m-%d}"})
                if payload:
                    rows += _rows(payload, m["currency"])
    finally:
        if own:
            client.close()
    if not rows:
        return pd.DataFrame(columns=schemas.ACTUALS.names).astype({"value": float})
    df = pd.DataFrame(rows)
    df["ts"] = pd.to_datetime(df["ts"], utc=True).dt.floor("h")
    df = df.groupby(["ts", "zone", "unit"], as_index=False)["value"].mean()
    df = df[(df["ts"] >= start.floor("h")) & (df["ts"] <= end)].assign(series="price_da")
    return schemas.validate(df[schemas.ACTUALS.names], "actuals")


def write(df: pd.DataFrame) -> list[str]:
    if df.empty:
        return []
    name = "actuals/nordpool_price_da"
    if cache.exists(name):
        df = pd.concat([pd.read_parquet(cache.path(name)), df], ignore_index=True)
    df = df.drop_duplicates(["ts", "zone"], keep="last").sort_values(["ts", "zone"])
    cache.write(name, schemas.validate(df, name))
    return [name]


def run(start, end) -> list[str]:
    return write(fetch(start, end))
