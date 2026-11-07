from datetime import datetime

from fastapi import APIRouter

from engine.routes._fixtures import fixture
from engine.schemas import ExplainResponse, Zone

router = APIRouter(tags=["forecast"])


@router.get("/explain", response_model=ExplainResponse)
def explain(zone: Zone = "GB", ts: datetime | None = None) -> dict:
    return fixture("explain")
