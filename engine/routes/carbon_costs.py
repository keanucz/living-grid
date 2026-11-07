"""GET /carbon/costs?at=&data_centre_mw=: what carbon adds to each MWh per zone, and the unpriced gap."""

from datetime import datetime

from fastapi import APIRouter, HTTPException

from engine import carbon_costs
from engine.schemas import CarbonCostsResponse

router = APIRouter(tags=["unseen"])


@router.get("/carbon/costs", response_model=CarbonCostsResponse)
def costs(at: datetime | None = None, data_centre_mw: float = carbon_costs.DEFAULT_DC_MW) -> dict:
    if not 0 < data_centre_mw <= 5000:
        raise HTTPException(422, "data_centre_mw must be between 0 and 5000")
    try:
        return carbon_costs.build(at, data_centre_mw)
    except LookupError as e:
        raise HTTPException(404, str(e)) from e
