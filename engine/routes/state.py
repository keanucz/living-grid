from datetime import datetime

from fastapi import APIRouter

from engine.routes._fixtures import fixture
from engine.schemas import StateResponse

router = APIRouter(tags=["map"])


@router.get("/state", response_model=StateResponse)
def state(at: datetime | None = None) -> dict:
    return fixture("state")
