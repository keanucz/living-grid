"""GET /impact/renewables?zone=&from=&to=: what wind and sun did to prices (estimated merit-order effect)."""

from datetime import datetime

import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from engine import data, impact
from engine.schemas import ImpactResponse

router = APIRouter(tags=["impact"])


@router.get("/impact/renewables", response_model=ImpactResponse)
def renewables(zone: str, from_: datetime | None = Query(None, alias="from"), to: datetime | None = None) -> dict:
    if zone not in data.ZONES:
        raise HTTPException(404, f"unknown zone {zone!r}")
    end = data.as_utc(to) if to is not None else None
    if end is None:
        a = data.actuals()
        w = a[(a["zone"] == zone) & a["series"].isin(impact.WIND_NAMES)]
        if w.empty:
            raise HTTPException(404, f"no wind data for {zone}")
        end = w["ts"].max()
    start = data.as_utc(from_) if from_ is not None else end - pd.Timedelta(hours=23)
    if start > end:
        raise HTTPException(422, "from must not be after to")
    try:
        return impact.renewables(zone, start, end)
    except LookupError as e:
        raise HTTPException(404, str(e)) from e
