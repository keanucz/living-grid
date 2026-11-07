from datetime import date

from fastapi import APIRouter

from engine.routes._fixtures import fixture
from engine.schemas import ReplayResponse

router = APIRouter(tags=["proof"])


@router.get("/replay", response_model=ReplayResponse)
def replay(event: date = date(2026, 10, 26)) -> dict:
    return fixture("replay")
