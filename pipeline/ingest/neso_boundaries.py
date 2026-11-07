"""NESO day-ahead flows and limits for every constraint group (not only the Scottish ones neso.py keeps).

Same dataset and parsing as neso.fetch_boundaries (flows are NESO's day-ahead forecast after energy scheduling and,
since 22 April 2024, before expected constraint actions, so flow above limit means constraint action is needed).
Written to data/neso/boundaries_all.parquet: ts (hour, UTC), boundary (NESO's own group code), flow_mw, limit_mw,
utilisation, fetched_at.
"""

from unittest import mock

import httpx
import pandas as pd

from pipeline import cache
from pipeline.ingest import neso

NAME = "neso/boundaries_all"


def groups(client: httpx.Client) -> list[str]:
    rows = neso._sql(client, f'SELECT DISTINCT "Constraint Group" AS g FROM "{neso.FLOW_RESOURCE}"')
    return sorted(r["g"] for r in rows if r.get("g"))


def fetch(start, end, client: httpx.Client | None = None, now=None) -> pd.DataFrame:
    client, own = neso._client(client)
    try:
        names = groups(client)
        # neso.fetch_boundaries reads its group map at call time; give it an identity map of every group.
        with mock.patch.object(neso, "BOUNDARIES", {g: g for g in names}):
            return neso.fetch_boundaries(start, end, client, now)
    finally:
        if own:
            client.close()


def run(start, end, client: httpx.Client | None = None) -> list[str]:
    df = fetch(start, end, client)
    if df.empty:
        return []
    if cache.exists(NAME):
        df = cache.concat([cache.read_file(cache.path(NAME)), df], ignore_index=True)
    cache.write(NAME, df.drop_duplicates(["ts", "boundary"], keep="last").sort_values(["ts", "boundary"]).reset_index(drop=True))
    return [NAME]
