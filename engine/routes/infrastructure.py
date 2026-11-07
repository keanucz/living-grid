"""GET /infrastructure: boundary bottlenecks, interconnector use, constraint costs, planned links and the B6 counterfactual."""

from fastapi import APIRouter, HTTPException, Query

from engine import infrastructure
from engine.schemas import InfrastructureResponse

router = APIRouter(tags=["unseen"])


@router.get("/infrastructure", response_model=InfrastructureResponse)
def get_infrastructure(extra_mw: list[float] = Query(list(infrastructure.EXTRA_MW))) -> dict:
    if not extra_mw or any(not 0 < e <= 10000 for e in extra_mw) or len(extra_mw) > 6:
        raise HTTPException(422, "extra_mw: up to 6 values between 0 and 10000")
    try:
        return infrastructure.build(tuple(extra_mw))
    except LookupError as e:
        raise HTTPException(404, str(e)) from e
