from datetime import datetime
from functools import lru_cache
from pathlib import Path

import pandas as pd
from fastapi import APIRouter, Query

from engine.ghost_wind import boalf, costs
from engine.routes._fixtures import fixture
from engine.schemas import GhostWindResponse
from pipeline import cache

router = APIRouter(tags=["unseen"])


def inputs() -> tuple[str, ...]:
    """Every cached file costs.build reads."""
    names = (boalf.BIDS, *costs.WEATHER, costs.METERED, costs.COSTS, costs.FLOWS)
    return tuple(str(cache.path(n)) for n in names)


def fingerprint() -> tuple:
    """Paths and mtimes of the inputs (and offline mode, which switches them to fixtures): the cache key."""
    return (cache.offline(), *((p, Path(p).stat().st_mtime_ns) for p in inputs() if Path(p).exists()))


# A build takes about 0.7 s on the runner's data, but the API has one worker and the page fires several calls at
# once, so a repeat (another screen, a reload, the storm tab) is served from here until an input file changes.
@lru_cache(maxsize=16)
def cached(start: pd.Timestamp, end: pd.Timestamp, key: tuple) -> dict:
    if not costs.has_data():
        body = fixture("ghost_wind")
        return {**body, "note": "Sample data: nothing has been ingested yet. " + body["note"]}
    return costs.build(start, end)


@router.get("/unseen/ghost-wind", response_model=GhostWindResponse)
def ghost_wind(from_: datetime | None = Query(None, alias="from"), to: datetime | None = None) -> dict:
    end = pd.Timestamp(to) if to else pd.Timestamp.now(tz="UTC").floor("h")
    start = pd.Timestamp(from_) if from_ else end - pd.Timedelta(hours=24)
    return cached(start, end, fingerprint())
