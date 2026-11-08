from datetime import UTC, date, datetime
from functools import lru_cache

import pandas as pd
from fastapi import APIRouter, HTTPException

from engine import data, timeline
from engine.schemas import StateDayResponse, StateResponse
from pipeline import cache

router = APIRouter(tags=["map"])


def default_at() -> pd.Timestamp:
    """The current UTC hour. Offline, capped at the latest metered hour so the fixtures still show data."""
    now = data.as_utc(datetime.now(UTC)).floor("h")
    latest = data.latest_actual_ts() if cache.offline() else None
    return min(now, latest.floor("h")) if latest is not None else now


@lru_cache(maxsize=2048)
def _past(t: pd.Timestamp, sig: tuple) -> dict:
    return _compute(t)


def build(at: datetime | None = None) -> dict:
    """Hours more than an hour in the past are cached per cache-file state, so scrubbing history is a lookup."""
    t = data.as_utc(at) if at else default_at()
    if t < data.as_utc(datetime.now(UTC)).floor("h") - pd.Timedelta(hours=1):
        return _past(t, timeline._signature())
    return _compute(t)


def _compute(t: pd.Timestamp) -> dict:
    prices, forecasts, carbon = data.prices(t), data.forecasts(t), data.carbon_at(t)
    load, mix = data.zone_series(t)
    d_load, d_mix, d_as_of = data.delayed_series(t, set(load))
    load, mix = {**d_load, **load}, {**d_mix, **mix}
    zones = [
        {
            "zone": z,
            "price": prices.get(z),
            "forecast": forecasts.get(z),
            "carbon": carbon.get(z),
            "load_mw": load.get(z),
            "mix_mw": mix.get(z, {}),
            "metered_as_of": d_as_of[z].to_pydatetime() if z in d_as_of else None,
        }
        for z in data.ZONES
    ]
    return {"at": t.to_pydatetime(), "zones": zones, "flows": data.link_flows(t)}


def _compute_day(day: pd.Timestamp) -> dict:
    hours = pd.date_range(day, periods=24, freq="h")
    with data.scoped(hours[0], hours[-1]):
        rows = [_compute(t) for t in hours]
    return {"date": day.date(), "hours": rows}


@lru_cache(maxsize=64)
def _day(day: pd.Timestamp, sig: tuple) -> dict:
    return _compute_day(day)


def build_day(day) -> dict:
    """The 24 hourly states of one UTC day, as GET /state would give each hour, from one slice of the cache.
    Memoised per day and cache-file state. The result is shared: read it, never mutate it."""
    d = data.as_utc(pd.Timestamp(day)).floor("D")
    return _day(d, timeline._signature())


@router.get("/state/day", response_model=StateDayResponse)
def state_day(date: date) -> dict:
    """Every hour of one UTC day in one response, for replay and scrubbing (24 GET /state calls in one)."""
    if pd.Timestamp(date) > pd.Timestamp(datetime.now(UTC).date()):
        raise HTTPException(422, "date must not be in the future")
    return build_day(date)


@router.get("/state", response_model=StateResponse)
def state(at: datetime | None = None) -> dict:
    return build(at)
