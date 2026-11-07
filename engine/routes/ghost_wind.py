from datetime import datetime

import pandas as pd
from fastapi import APIRouter, Query

from engine.ghost_wind import costs
from engine.routes._fixtures import fixture
from engine.schemas import GhostWindResponse

router = APIRouter(tags=["unseen"])


@router.get("/unseen/ghost-wind", response_model=GhostWindResponse)
def ghost_wind(from_: datetime | None = Query(None, alias="from"), to: datetime | None = None) -> dict:
    if not costs.has_data():
        body = fixture("ghost_wind")
        return {**body, "note": "Sample data: nothing has been ingested yet. " + body["note"]}
    end = pd.Timestamp(to) if to else pd.Timestamp.now(tz="UTC").floor("h")
    start = pd.Timestamp(from_) if from_ else end - pd.Timedelta(hours=24)
    return costs.build(start, end)
