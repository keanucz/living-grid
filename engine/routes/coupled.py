"""GET /coupled: today's day-ahead prices for the coupled market around Britain (engine.coupled). Additive; off by default in the web app."""

from datetime import datetime

import pandas as pd
from fastapi import APIRouter, HTTPException

from engine import coupled
from engine.routes._fixtures import fixture
from engine.schemas import CoupledResponse
from pipeline import cache

router = APIRouter(tags=["map"])


@router.get("/coupled", response_model=CoupledResponse)
def get_coupled(at: datetime | None = None) -> dict:
    t = pd.Timestamp(at) if at else pd.Timestamp.now(tz="UTC")
    t = t.tz_localize("UTC") if t.tzinfo is None else t.tz_convert("UTC")
    day = coupled.delivery_day(t)
    try:
        df, fetched = coupled.hourly(day)
    except coupled.Unavailable as e:
        if cache.offline():
            return fixture("coupled")
        raise HTTPException(503, f"no coupled prices for {day}: {e}") from e
    return coupled.response(df, day, t, fetched)
