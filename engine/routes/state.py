from datetime import UTC, datetime

from fastapi import APIRouter

from engine import data
from engine.schemas import StateResponse

router = APIRouter(tags=["map"])


def build(at: datetime | None = None) -> dict:
    t = data.as_utc(at) if at else data.latest_price_ts() or data.as_utc(datetime.now(UTC)).floor("h")
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
