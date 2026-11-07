from datetime import datetime

from fastapi import APIRouter, Query

from engine.routes._fixtures import fixture
from engine.schemas import GhostWindResponse

router = APIRouter(tags=["unseen"])


@router.get("/unseen/ghost-wind", response_model=GhostWindResponse)
def ghost_wind(from_: datetime | None = Query(None, alias="from"), to: datetime | None = None) -> dict:
    return fixture("ghost_wind")
