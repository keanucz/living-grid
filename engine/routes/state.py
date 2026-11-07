from datetime import UTC, datetime

import pandas as pd
from fastapi import APIRouter

from engine import data
from engine.schemas import StateResponse
from pipeline import cache

router = APIRouter(tags=["map"])


def default_at() -> pd.Timestamp:
    """The current UTC hour. Offline, capped at the latest metered hour so the fixtures still show data."""
    now = data.as_utc(datetime.now(UTC)).floor("h")
    latest = data.latest_actual_ts() if cache.offline() else None
    return min(now, latest.floor("h")) if latest is not None else now


def build(at: datetime | None = None) -> dict:
    t = data.as_utc(at) if at else default_at()
    prices, forecasts, carbon = data.prices(t), data.forecasts(t), data.carbon_at(t)
    load, mix = data.zone_series(t)
    zones = [
        {
            "zone": z,
            "price": prices.get(z),
            "forecast": forecasts.get(z),
            "carbon": carbon.get(z),
            "load_mw": load.get(z),
            "mix_mw": mix.get(z, {}),
        }
        for z in data.ZONES
    ]
    return {"at": t.to_pydatetime(), "zones": zones, "flows": data.link_flows(t)}


@router.get("/state", response_model=StateResponse)
def state(at: datetime | None = None) -> dict:
    return build(at)
