"""Wind bids accepted by the system operator (the volume behind ghost wind estimate 1).

Volumes come from Elexon's settled acceptance volumes (BOAV, bids per settlement period), which carry
the MWh of the same acceptances that BOALF lists; BOALF itself gives levels, not energy. Units are
joined to /reference/bmunits/all on nationalGridBmUnit and kept when the reference says WIND. Region
comes from the hand map data/static/wind_farms.csv (keyed on the BM unit stem, e.g. VKNGW from
VKNGW-1); unmapped wind units keep region None. BOAV covers every accepted bid on a wind unit, not only
constraint actions, so treat the total as an upper bound on constraint curtailment.

Outputs:
  data/boalf/wind_bids.parquet   ts (hour, UTC), bm_unit, region, capacity_mw, mwh (curtailed, positive)
  data/boalf/wind_units.parquet  bm_unit, name, lead_party, capacity_mw, region, mapped
  data/actuals/elexon_boalf_mwh  GB hourly total as the shared series boalf_mwh
"""

import time

import httpx
import pandas as pd

from pipeline import cache, schemas, static

BASE = "https://data.elexon.co.uk/bmrs/api/v1"
BIDS = "boalf/wind_bids"
UNITS = "boalf/wind_units"
BID_COLUMNS = ["ts", "bm_unit", "region", "capacity_mw", "mwh"]
UNIT_COLUMNS = ["bm_unit", "name", "lead_party", "capacity_mw", "region", "mapped"]
PERIODS = range(1, 51)


def _get(client: httpx.Client, path: str):
    for attempt in range(4):
        r = client.get(f"{BASE}/{path}", params={"format": "json"})
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(float(r.headers.get("Retry-After", 2**attempt)))
            continue
        if r.status_code in (400, 404):
            return None
        r.raise_for_status()
        return r.json()
    r.raise_for_status()


def wind_units(client: httpx.Client) -> pd.DataFrame:
    ref = pd.DataFrame(_get(client, "reference/bmunits/all"))
    ref = ref[ref["fuelType"] == "WIND"]
    farms = static.wind_farms()
    region = dict(zip(farms["bm_unit"], farms["region"], strict=True))
    df = pd.DataFrame(
        {
            "bm_unit": ref["nationalGridBmUnit"],
            "name": ref["bmUnitName"],
            "lead_party": ref["leadPartyName"],
            "capacity_mw": pd.to_numeric(ref["generationCapacity"], errors="coerce"),
        }
    )
    df["region"] = df["bm_unit"].str.rsplit("-", n=1).str[0].map(region)
    df["mapped"] = df["region"].notna()
    return df.drop_duplicates("bm_unit").reset_index(drop=True)[UNIT_COLUMNS]


def fetch_bids(start, end, client: httpx.Client, units: pd.DataFrame) -> pd.DataFrame:
    start, end = pd.Timestamp(start), pd.Timestamp(end)
    rows = []
    for day in pd.date_range(start.normalize(), end.normalize(), freq="D"):
        for p in PERIODS:
            body = _get(client, f"balancing/settlement/acceptance/volumes/all/bid/{day:%Y-%m-%d}/{p}")
            if body:
                rows += body["data"]
    if not rows:
        return pd.DataFrame(columns=BID_COLUMNS)
    df = pd.DataFrame(rows).rename(columns={"nationalGridBmUnit": "bm_unit"})
    df = df.merge(units[["bm_unit", "region", "capacity_mw"]], on="bm_unit")
    df["ts"] = pd.to_datetime(df["startTime"], utc=True).dt.floor("h")
    df["mwh"] = -df["totalVolumeAccepted"].astype(float)
    df = df.groupby(["ts", "bm_unit"], as_index=False, dropna=False).agg(
        region=("region", "first"), capacity_mw=("capacity_mw", "first"), mwh=("mwh", "sum")
    )
    df = df[(df["ts"] >= start.floor("h")) & (df["ts"] <= end)]
    return df[BID_COLUMNS].reset_index(drop=True)


def _total(bids: pd.DataFrame, start, end) -> pd.DataFrame:
    """GB hourly total over [start, end]; hours with no accepted wind bids are 0, not missing."""
    hours = pd.date_range(pd.Timestamp(start).floor("h"), pd.Timestamp(end), freq="h", tz="UTC")
    t = bids.groupby("ts")["mwh"].sum().reindex(hours, fill_value=0.0)
    df = pd.DataFrame({"ts": hours, "value": t.to_numpy()})
    return schemas.validate(df.assign(zone="GB", series="boalf_mwh", unit="MWh"), "actuals/elexon_boalf_mwh")


def fetch(start, end, client: httpx.Client | None = None) -> pd.DataFrame:
    """Ingest-registry entry point: GB hourly curtailed wind MWh as an actuals frame."""
    if cache.offline():
        raise RuntimeError("LG_OFFLINE is set: BOALF ingest needs the network")
    own = client is None
    client = client or httpx.Client(timeout=60)
    try:
        return _total(fetch_bids(start, end, client, wind_units(client)), start, end)
    finally:
        if own:
            client.close()


def run(start, end, client: httpx.Client | None = None) -> list[str]:
    if cache.offline():
        raise RuntimeError("LG_OFFLINE is set: BOALF ingest needs the network")
    own = client is None
    client = client or httpx.Client(timeout=60)
    try:
        units = wind_units(client)
        bids = fetch_bids(start, end, client, units)
    finally:
        if own:
            client.close()
    cache.write(UNITS, units)
    total = _total(bids, start, end)
    merged = bids
    if cache.exists(BIDS):
        merged = cache.concat([cache.read_file(cache.path(BIDS)), bids], ignore_index=True)
    merged = merged.drop_duplicates(["ts", "bm_unit"], keep="last").sort_values(["ts", "bm_unit"])
    cache.write(BIDS, merged.reset_index(drop=True))
    name = "actuals/elexon_boalf_mwh"
    if cache.exists(name):
        total = cache.concat([cache.read_file(cache.path(name)), total], ignore_index=True)
        total = total.drop_duplicates(["ts", "zone"], keep="last").sort_values("ts")
    cache.write(name, schemas.validate(total, name))
    return [UNITS, BIDS, name]
