"""Octopus Agile unit rates for the 14 GB regions.

Agile is a retail tariff (pence per kWh including VAT and network charges), so it is a household price
signal and not a congestion signal. Rates are half-hourly and are kept half-hourly, because household
advice picks half-hour windows. Tomorrow's rates appear at about 16:00 UK, so a fetch for a future day
before then simply returns fewer rows.

Output: data/octopus/agile.parquet  ts (half-hour start, UTC), region (letter), p_kwh (inc VAT), fetched_at
"""

import time

import httpx
import pandas as pd

from pipeline import cache, static

BASE = "https://api.octopus.energy/v1"
NAME = "octopus/agile"
COLUMNS = ["ts", "region", "p_kwh", "fetched_at"]
PAGE_SIZE = 1500


def _get(client: httpx.Client, url: str, params: dict | None = None) -> dict:
    for attempt in range(4):
        r = client.get(url, params=params)
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(float(r.headers.get("Retry-After", 2**attempt)))
            continue
        r.raise_for_status()
        return r.json()
    r.raise_for_status()


def current_product(client: httpx.Client) -> str:
    """The newest Agile import product (outgoing tariffs excluded)."""
    products = []
    url, params = f"{BASE}/products/", {"brand": "OCTOPUS_ENERGY", "is_variable": "true"}
    while url:
        body = _get(client, url, params)
        products += [p for p in body["results"] if p["code"].startswith("AGILE-") and "OUTGOING" not in p["code"]]
        url, params = body.get("next"), None
    if not products:
        raise RuntimeError("no Agile product found")
    return max(products, key=lambda p: p["available_from"])["code"]


def _utc(x) -> pd.Timestamp:
    x = pd.Timestamp(x)
    return x.tz_localize("UTC") if x.tzinfo is None else x.tz_convert("UTC")


def fetch_rates(start, end, client: httpx.Client, product: str | None = None, now=None) -> pd.DataFrame:
    start, end = _utc(start), _utc(end)
    fetched = pd.Timestamp.now(tz="UTC") if now is None else _utc(now)
    product = product or current_product(client)
    rows = []
    for region in static.gb_region_keys()["region"]:
        url = f"{BASE}/products/{product}/electricity-tariffs/E-1R-{product}-{region}/standard-unit-rates/"
        params = {
            "period_from": f"{start:%Y-%m-%dT%H:%MZ}",
            "period_to": f"{end + pd.Timedelta(minutes=30):%Y-%m-%dT%H:%MZ}",
            "page_size": PAGE_SIZE,
        }
        while url:
            body = _get(client, url, params)
            rows += [{"ts": r["valid_from"], "region": region, "p_kwh": r["value_inc_vat"]} for r in body["results"]]
            url, params = body.get("next"), None
    if not rows:
        return pd.DataFrame(columns=COLUMNS)
    df = pd.DataFrame(rows)
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    df["p_kwh"] = df["p_kwh"].astype(float)
    df = df[(df["ts"] >= start) & (df["ts"] <= end)].drop_duplicates(["ts", "region"], keep="last")
    df["fetched_at"] = fetched
    return df[COLUMNS].sort_values(["ts", "region"]).reset_index(drop=True)


def fetch(start, end, client: httpx.Client | None = None) -> pd.DataFrame:
    """Ingest-registry entry point: Agile rates for all 14 regions."""
    if cache.offline():
        raise RuntimeError("LG_OFFLINE is set: Octopus ingest needs the network")
    own = client is None
    client = client or httpx.Client(timeout=60)
    try:
        return fetch_rates(start, end, client)
    finally:
        if own:
            client.close()


def write(df: pd.DataFrame) -> list[str]:
    if df.empty:
        return []
    if cache.exists(NAME):
        df = cache.concat([cache.read_file(cache.path(NAME)), df], ignore_index=True)
    cache.write(NAME, df.drop_duplicates(["ts", "region"], keep="last").sort_values(["ts", "region"]).reset_index(drop=True))
    return [NAME]


def run(start, end, client: httpx.Client | None = None) -> list[str]:
    return write(fetch(start, end, client))
