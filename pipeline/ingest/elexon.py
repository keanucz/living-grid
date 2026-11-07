"""Elexon Insights: GB system price, demand, generation mix and interconnector flows.

Series (zone GB, hourly UTC means of half-hours):
  system_price         GBP/MWh, systemSellPrice
  market_index         GBP/MWh, market index price (MID, APX provider; zero-volume periods dropped). Out within
                       minutes, so the room game uses it as provisional feedback before the system price lands.
  load                 MW, initial national demand outturn
  gen_<fuel>           MW, FUELHH (CCGT + OCGT are summed into gen_gas)
  flow_GB_<zone>       MW from GB to <zone>: positive is export, so imports are negative.
                       Elexon reports imports as positive; links to one zone are summed.
"""

import time

import httpx
import pandas as pd

from pipeline import cache, schemas

BASE = "https://data.elexon.co.uk/bmrs/api/v1"
MAX_DAYS = 7
MID_PROVIDER = "APXMIDP"  # N2EXMIDP is published with zero price and volume

FUELS = {
    "WIND": "wind",
    "CCGT": "gas",
    "OCGT": "gas",
    "NUCLEAR": "nuclear",
    "BIOMASS": "biomass",
    "COAL": "coal",
    "OIL": "oil",
    "NPSHYD": "hydro",
    "PS": "pumped_storage",
    "OTHER": "other",
}
LINKS = {
    "INTFR": "FR",
    "INTIFA2": "FR",
    "INTELEC": "FR",
    "INTNED": "NL",
    "INTNEM": "BE",
    "INTNSL": "NO2",
    "INTVKL": "DK1",
    "INTGRNL": "IE",
    "INTEW": "IE",
    "INTIRL": "NI",
}


def _get(client: httpx.Client, path: str, params: dict):
    for attempt in range(4):
        r = client.get(f"{BASE}/{path}", params={**params, "format": "json"})
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(float(r.headers.get("Retry-After", 2**attempt)))
            continue
        r.raise_for_status()
        return r.json()
    r.raise_for_status()


def _windows(start: pd.Timestamp, end: pd.Timestamp):
    d = start.normalize()
    while d <= end:
        yield d, min(d + pd.Timedelta(days=MAX_DAYS - 1), end.normalize())
        d += pd.Timedelta(days=MAX_DAYS)


def _hourly(df: pd.DataFrame, series: str, unit: str) -> pd.DataFrame:
    df = df.assign(ts=df["ts"].dt.floor("h")).groupby("ts", as_index=False)["value"].mean()
    return df.assign(zone="GB", series=series, unit=unit)


def _frame(rows, ts_key: str, value_key: str) -> pd.DataFrame:
    df = pd.DataFrame(rows)
    if df.empty:
        return pd.DataFrame(columns=["ts", "value"]).astype({"value": float})
    return pd.DataFrame({"ts": pd.to_datetime(df[ts_key], utc=True), "value": df[value_key].astype(float)})


def _system_price(client, start, end) -> pd.DataFrame:
    rows = []
    for day in pd.date_range(start.normalize(), end.normalize(), freq="D"):
        rows += _get(client, f"balancing/settlement/system-prices/{day:%Y-%m-%d}", {})["data"]
    return _hourly(_frame(rows, "startTime", "systemSellPrice"), "system_price", "GBP/MWh")


def _market_index(client, start, end) -> pd.DataFrame:
    rows = []
    for a, b in _windows(start, end):
        params = {"from": f"{a:%Y-%m-%dT00:00Z}", "to": f"{b:%Y-%m-%dT23:30Z}", "dataProviders": MID_PROVIDER}
        rows += _get(client, "balancing/pricing/market-index", params)["data"]
    rows = [r for r in rows if r.get("dataProvider") == MID_PROVIDER and (r.get("volume") or 0) > 0]
    df = _frame(rows, "startTime", "price").drop_duplicates("ts", keep="last")
    return _hourly(df, "market_index", "GBP/MWh")


def _stream(client, path, start, end):
    rows = []
    for a, b in _windows(start, end):
        rows += _get(client, path, {"settlementDateFrom": f"{a:%Y-%m-%d}", "settlementDateTo": f"{b:%Y-%m-%d}"})
    return rows


def _demand(client, start, end) -> pd.DataFrame:
    rows = _stream(client, "demand/outturn/stream", start, end)
    return _hourly(_frame(rows, "startTime", "initialDemandOutturn"), "load", "MW")


def _fuelhh(client, start, end) -> list[pd.DataFrame]:
    rows = _stream(client, "datasets/FUELHH/stream", start, end)
    out = []
    df = pd.DataFrame(rows)
    if df.empty:
        return out
    df["ts"] = pd.to_datetime(df["startTime"], utc=True)
    df = df.drop_duplicates(["ts", "fuelType"], keep="last")
    gen = df[df["fuelType"].isin(FUELS)].assign(series=lambda d: "gen_" + d["fuelType"].map(FUELS))
    for series, g in gen.groupby("series"):
        g = g.groupby("ts", as_index=False)["generation"].sum().rename(columns={"generation": "value"})
        out.append(_hourly(g, series, "MW"))
    flows = df[df["fuelType"].isin(LINKS)].assign(zone_to=lambda d: d["fuelType"].map(LINKS))
    for zone, g in flows.groupby("zone_to"):
        g = g.groupby("ts", as_index=False)["generation"].sum().rename(columns={"generation": "value"})
        g["value"] = -g["value"]
        out.append(_hourly(g, f"flow_GB_{zone}", "MW"))
    return out


def fetch(start, end, client: httpx.Client | None = None) -> pd.DataFrame:
    """All Elexon actuals for [start, end] as one validated long frame."""
    if cache.offline():
        raise RuntimeError("LG_OFFLINE is set: Elexon ingest needs the network")
    start, end = pd.Timestamp(start), pd.Timestamp(end)
    own = client is None
    client = client or httpx.Client(timeout=60)
    try:
        parts = [_system_price(client, start, end), _market_index(client, start, end), _demand(client, start, end), *_fuelhh(client, start, end)]
    finally:
        if own:
            client.close()
    df = pd.concat(parts, ignore_index=True)
    df = df[(df["ts"] >= start.floor("h")) & (df["ts"] <= end)]
    return schemas.validate(df[schemas.ACTUALS.names], "actuals")


def write(df: pd.DataFrame) -> list[str]:
    """Merge into data/actuals/elexon_{series}.parquet, newest values winning."""
    names = []
    for series, g in df.groupby("series"):
        name = f"actuals/elexon_{series}"
        if cache.exists(name):
            g = cache.concat([cache.read_file(cache.path(name)), g], ignore_index=True)
        g = g.drop_duplicates(["ts", "zone"], keep="last").sort_values("ts")
        cache.write(name, schemas.validate(g, name))
        names.append(name)
    return names


def run(start, end) -> list[str]:
    return write(fetch(start, end))
