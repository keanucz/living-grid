from datetime import date

from fastapi import APIRouter, HTTPException

from engine import replay as rp
from engine.routes._fixtures import fixture
from engine.schemas import ReplayResponse

router = APIRouter(tags=["proof"])


@router.get("/replay", response_model=ReplayResponse)
def replay(event: date = rp.HEADLINE_EVENT) -> dict:
    cached = rp.load(event)
    if cached is not None:
        return cached
    if event == rp.HEADLINE_EVENT:
        return fixture("replay")  # contract sample until the as-of model has been trained and `python -m engine.replay` run
    raise HTTPException(404, f"no replay for {event}; precompute it with: python -m engine.replay --event {event}")
