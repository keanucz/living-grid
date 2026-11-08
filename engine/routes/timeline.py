"""GET /timeline?from=&to=&step=hour|day: compact per-zone history and event markers for the scrubber strip."""

from datetime import datetime
from typing import Literal

import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from engine import data, timeline
from engine.schemas import TimelineResponse

router = APIRouter(tags=["map"])


@router.get("/timeline", response_model=TimelineResponse, response_model_by_alias=True)
def get_timeline(
    from_: datetime | None = Query(None, alias="from"),
    to: datetime | None = None,
    step: Literal["hour", "day"] = "day",
) -> dict:
    hi = data.as_utc(to) if to else pd.Timestamp.now(tz="UTC").floor("h")
    lo = data.as_utc(from_) if from_ else pd.Timestamp("2024-01-01", tz="UTC")
    try:
        return timeline.build(lo, hi, step)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
