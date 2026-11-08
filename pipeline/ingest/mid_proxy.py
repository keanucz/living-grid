"""GB day-ahead price proxy from the Elexon market index (MID, APX provider) for dates Nord Pool no longer serves.

The market index is the traded hourly reference price for GB, not the N2EX auction result, so it is stored as
a separate source (`mid`) and ranked below Nord Pool: where the real day-ahead price exists it wins.
Series price_da, zone GB, GBP/MWh, hourly UTC (half-hours averaged; zero-volume periods dropped).
"""

import httpx
import pandas as pd

from pipeline import cache, schemas
from pipeline.ingest import elexon


def fetch(start, end, client: httpx.Client | None = None) -> pd.DataFrame:
    if cache.offline():
        raise RuntimeError("LG_OFFLINE is set: market index ingest needs the network")
    start, end = (pd.Timestamp(t) for t in (start, end))
    start, end = (t.tz_localize("UTC") if t.tzinfo is None else t for t in (start, end))
    own = client is None
    client = client or httpx.Client(timeout=60)
    try:
        df = elexon._market_index(client, start, end)
    finally:
        if own:
            client.close()
    df = df[(df["ts"] >= start.floor("h")) & (df["ts"] <= end)].assign(series="price_da")
    return schemas.validate(df[schemas.ACTUALS.names], "actuals")


def write(df: pd.DataFrame) -> list[str]:
    if df.empty:
        return []
    name = "actuals/mid_price_da"
    if cache.exists(name):
        df = cache.concat([cache.read_file(cache.path(name)), df], ignore_index=True)
    df = df.drop_duplicates(["ts", "zone"], keep="last").sort_values("ts")
    cache.write(name, schemas.validate(df, name))
    return [name]


def run(start, end) -> list[str]:
    return write(fetch(start, end))
